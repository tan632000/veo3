/**
 * BatchOrchestrator — State machine for batch video generation
 * Orchestrates the full lifecycle: idle → running → paused → completed/cancelled
 */

import { StorageKeys, storageGet, storageSet } from '../shared/storage.js';
import { MessageType, sendToContentScript } from '../shared/messages.js';
import { getConfig } from './config-manager.js';
import { saveBatchRecord } from './history-manager.js';
import { logError } from './error-logger.js';

const KEEPALIVE_ALARM = 'batch-keepalive';
const KEEPALIVE_INTERVAL = 0.4; // minutes (24 seconds)

/** @type {object|null} Current batch state in memory */
let batchState = null;

/** @type {number|null} Active Google Flow tab id */
let activeTabId = null;

/** @type {function|null} Side panel update callback */
let onStateUpdate = null;

/**
 * Set callback for state updates (called by service worker to forward to side panel)
 */
export function setStateUpdateCallback(callback) {
  onStateUpdate = callback;
}

/**
 * Get current batch state
 */
export function getBatchState() {
  return batchState;
}

/**
 * Initialize orchestrator — load persisted state on service worker startup
 */
export async function initOrchestrator() {
  const saved = await storageGet(StorageKeys.BATCH_STATE);
  if (saved && saved.status === 'running') {
    batchState = saved;
    // Recover lastSuccessfulFrame from dedicated storage
    const frameData = await storageGet('last_frame_image');
    if (frameData) {
      batchState.lastSuccessfulFrame = frameData;
      console.log('[Orchestrator] Recovered last frame image from storage');
    }
    console.log('[Orchestrator] Recovered running batch, resuming...');
    await startKeepAlive();
    // Resume from current index
    executeNextPrompt();
  } else if (saved && saved.status === 'paused') {
    batchState = saved;
    // Recover lastSuccessfulFrame from dedicated storage
    const frameData = await storageGet('last_frame_image');
    if (frameData) {
      batchState.lastSuccessfulFrame = frameData;
    }
    console.log('[Orchestrator] Recovered paused batch, waiting for resume.');
  } else {
    batchState = null;
  }
}

/**
 * Start a new batch
 * @param {object} promptsData - { common: string, list: Array<{id, text}> }
 * @param {number} tabId - Google Flow tab id
 */
export async function startBatch(promptsData, tabId) {
  if (batchState && batchState.status === 'running') {
    throw new Error('A batch is already running');
  }

  const config = await getConfig();

  activeTabId = tabId;
  batchState = {
    status: 'running',
    batchId: crypto.randomUUID(),
    commonPrompt: promptsData.common || '',
    prompts: promptsData.list.map(p => ({
      promptId: p.id,
      text: p.text,
      status: 'pending',
      retryCount: 0,
      extractedFrame: null,
      error: null,
      startedAt: null,
      completedAt: null,
    })),
    currentIndex: 0,
    lastSuccessfulFrame: config.firstFrameImage || null,
    startedAt: Date.now(),
    completedAt: null,
    config,
  };

  await persistState();
  await startKeepAlive();
  broadcastState();
  executeNextPrompt();
}

/**
 * Pause the batch — stops after current video completes
 */
export async function pauseBatch() {
  if (!batchState || batchState.status !== 'running') return;
  batchState.status = 'paused';
  await persistState();
  await stopKeepAlive();
  broadcastState();
}

/**
 * Resume a paused batch
 */
export async function resumeBatch() {
  if (!batchState || batchState.status !== 'paused') return;
  batchState.status = 'running';
  await persistState();
  await startKeepAlive();
  broadcastState();
  executeNextPrompt();
}

/**
 * Cancel the batch immediately
 */
export async function cancelBatch() {
  if (!batchState) return;
  batchState.status = 'cancelled';
  batchState.completedAt = Date.now();
  // Mark remaining pending prompts
  batchState.prompts.forEach(p => {
    if (p.status === 'generating') p.status = 'pending';
  });
  await persistState();
  await stopKeepAlive();
  await saveBatchToHistory();
  broadcastState();
}

/**
 * Handle command result from content script
 */
export async function handleCommandResult(result) {
  if (!batchState || batchState.status !== 'running') return;

  const current = batchState.prompts[batchState.currentIndex];
  if (!current) return;

  if (result.success) {
    current.status = 'completed';
    current.completedAt = Date.now();

    if (result.data && result.data.frameDataUrl) {
      current.extractedFrame = result.data.frameDataUrl;
      batchState.lastSuccessfulFrame = result.data.frameDataUrl;
      // Persist frame image separately (too large for batch state)
      await storageSet('last_frame_image', result.data.frameDataUrl);
      console.log(`[Orchestrator] ✅ Saved extracted frame for chaining (${(result.data.frameDataUrl.length / 1024).toFixed(0)}KB)`);
    } else {
      console.log('[Orchestrator] Video completed but no frame extracted (chaining disabled or extraction failed)');
    }

    await persistState();
    broadcastState();

    // Delay before next prompt
    const delay = batchState.config.delayBetweenGenerations || 3000;
    setTimeout(() => {
      batchState.currentIndex++;
      executeNextPrompt();
    }, delay);

  } else {
    // Handle error with retry
    current.retryCount++;
    const maxRetries = batchState.config.maxRetries || 3;

    if (current.retryCount < maxRetries) {
      // Retry with exponential backoff
      const retryDelay = Math.pow(2, current.retryCount) * 1000;
      console.log(`[Orchestrator] Retrying prompt ${current.promptId} in ${retryDelay}ms (attempt ${current.retryCount + 1})`);

      await logError({
        batchId: batchState.batchId,
        promptId: current.promptId,
        category: 'system',
        message: `Retry ${current.retryCount}/${maxRetries}: ${result.error}`,
        context: { retryDelay: String(retryDelay) },
      });

      setTimeout(() => executeCurrentPrompt(), retryDelay);
    } else {
      // Max retries reached — skip
      current.status = 'error';
      current.error = result.error || 'Max retries exceeded';
      current.completedAt = Date.now();

      await logError({
        batchId: batchState.batchId,
        promptId: current.promptId,
        category: 'business',
        message: `Prompt failed after ${maxRetries} retries: ${result.error}`,
      });

      if (batchState.config.skipOnError) {
        batchState.currentIndex++;
        await persistState();
        broadcastState();
        executeNextPrompt();
      } else {
        batchState.status = 'paused';
        await persistState();
        await stopKeepAlive();
        broadcastState();
      }
    }
  }
}

// --- Internal helpers ---

async function executeNextPrompt() {
  if (!batchState || batchState.status !== 'running') return;

  if (batchState.currentIndex >= batchState.prompts.length) {
    // Batch complete
    batchState.status = 'completed';
    batchState.completedAt = Date.now();
    await persistState();
    await stopKeepAlive();
    await saveBatchToHistory();
    broadcastState();
    return;
  }

  executeCurrentPrompt();
}

async function executeCurrentPrompt() {
  if (!batchState || batchState.status !== 'running') return;

  const current = batchState.prompts[batchState.currentIndex];
  current.status = 'generating';
  current.startedAt = current.startedAt || Date.now();
  await persistState();
  broadcastState();

  // Re-discover the Flow tab (it may have changed or activeTabId may be null after reload)
  try {
    const tabs = await chrome.tabs.query({ url: 'https://labs.google/*', active: true, currentWindow: true });
    let tabId = tabs.length > 0 ? tabs[0].id : null;
    if (!tabId) {
      const allTabs = await chrome.tabs.query({ url: 'https://labs.google/*' });
      tabId = allTabs.length > 0 ? allTabs[0].id : null;
    }
    if (!tabId || typeof tabId !== 'number') {
      console.error('[Orchestrator] No valid Flow tab found');
      await handleCommandResult({
        success: false,
        error: 'Google Flow tab not found. Please open Google Flow and try again.',
      });
      return;
    }
    activeTabId = tabId;
  } catch (err) {
    console.error('[Orchestrator] Tab query failed:', err);
    await handleCommandResult({ success: false, error: `Tab query failed: ${err.message}` });
    return;
  }

  // Ensure content script is loaded and responsive
  try {
    const pingRes = await chrome.tabs.sendMessage(activeTabId, { type: 'PING' });
    if (!pingRes || !pingRes.success) throw new Error('No valid ping response');
  } catch (err) {
    console.log('[Orchestrator] Content script not responding on tab, injecting manually...');
    try {
      if (chrome.scripting) {
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          files: [
            'src/content/selectors.js',
            'src/content/frame-extractor.js',
            'src/content/flow-automator.js',
            'src/content/content.js',
          ],
        });
        // Give it a moment to initialize
        await new Promise(r => setTimeout(r, 1000));
      } else {
        throw new Error('chrome.scripting API not available');
      }
    } catch (injErr) {
      console.error('[Orchestrator] Failed to inject content script:', injErr);
      await handleCommandResult({ success: false, error: 'Cannot connect to Google Flow tab. Please refresh the Google Flow page.' });
      return;
    }
  }

  // Send automation command to content script
  try {
    // Store frame image in storage (too large for message passing)
    if (batchState.lastSuccessfulFrame) {
      await storageSet('current_frame_image', batchState.lastSuccessfulFrame);
    }

    // Construct full prompt text
    const common = batchState.commonPrompt ? batchState.commonPrompt.trim() + ' ' : '';
    const fullPromptText = common + current.text.trim();

    await sendToContentScript(activeTabId, MessageType.EXECUTE_COMMAND, {
      promptText: fullPromptText,
      hasFrameImage: !!batchState.lastSuccessfulFrame,
      promptIndex: batchState.currentIndex,
      totalPrompts: batchState.prompts.length,
      options: {
        aspectRatio: batchState.config.aspectRatio || '16:9',
        useLowerPriority: batchState.config.useLowerPriority !== false,
        extractLastFrame: !!batchState.config.extractLastFrame,
      },
    });
  } catch (err) {
    console.error('[Orchestrator] Failed to send command to content script:', err);
    await handleCommandResult({
      success: false,
      error: `Content script communication failed: ${err.message}`,
    });
  }
}

async function persistState() {
  try {
    if (!batchState) return;
    
    // Create a copy without large image data to save storage quota
    // Frame image is saved separately via 'last_frame_image' key
    const stateToSave = {
      ...batchState,
      prompts: batchState.prompts.map(p => ({ ...p, extractedFrame: null })),
      config: { ...batchState.config, firstFrameImage: null },
      lastSuccessfulFrame: null, // stored separately to avoid quota issues
    };
    
    await storageSet(StorageKeys.BATCH_STATE, stateToSave);
  } catch (err) {
    console.error('[Orchestrator] Failed to persist state:', err);
  }
}

function broadcastState() {
  if (onStateUpdate && batchState) {
    onStateUpdate({ ...batchState });
  }
}

async function saveBatchToHistory() {
  if (!batchState) return;
  const successCount = batchState.prompts.filter(p => p.status === 'completed').length;
  const errorCount = batchState.prompts.filter(p => p.status === 'error').length;

  await saveBatchRecord({
    batchId: batchState.batchId,
    prompts: batchState.prompts.map(p => ({ ...p, extractedFrame: null })), // Don't store frames in history
    config: { ...batchState.config, firstFrameImage: null }, // Don't store image in history
    startedAt: batchState.startedAt,
    completedAt: batchState.completedAt || Date.now(),
    successCount,
    errorCount,
  });
}

async function startKeepAlive() {
  await chrome.alarms.create(KEEPALIVE_ALARM, {
    periodInMinutes: KEEPALIVE_INTERVAL,
  });
}

async function stopKeepAlive() {
  await chrome.alarms.clear(KEEPALIVE_ALARM);
}

// Handle alarm for keep-alive
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    console.log('[Orchestrator] Keep-alive ping');
  }
});
