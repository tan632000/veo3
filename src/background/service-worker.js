/**
 * Service Worker — Main entry point for background processing
 * Routes messages between Side Panel and Content Script
 */

import { MessageType, MessageSource, createMessage } from '../shared/messages.js';
import { getPrompts, addPrompts, updatePrompt, deletePrompt, reorderPrompts, clearAllPrompts, setCommonPrompt } from './prompt-manager.js';
import { getConfig, updateConfig, resetConfig } from './config-manager.js';
import { getHistory, deleteBatchRecord, clearHistory } from './history-manager.js';
import { getStorageUsage } from '../shared/storage.js';
import {
  initOrchestrator,
  startBatch,
  pauseBatch,
  resumeBatch,
  cancelBatch,
  getBatchState,
  handleCommandResult,
  setStateUpdateCallback,
} from './batch-orchestrator.js';

console.log('[ServiceWorker] Veo3 Bulk Video — Service Worker started');

// Initialize orchestrator (recover state if needed)
initOrchestrator();

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Set default side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Forward state updates to side panel
setStateUpdateCallback((state) => {
  broadcastToSidePanel(MessageType.STATE_UPDATE, { state });
});

/**
 * Main message handler — routes all incoming messages
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(err => {
      console.error('[ServiceWorker] Message handler error:', err);
      sendResponse({ success: false, error: err.message });
    });
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  const { type, payload } = message;

  switch (type) {
    // --- Prompt management ---
    case MessageType.GET_PROMPTS:
      return { success: true, data: await getPrompts() };

    case MessageType.SAVE_PROMPTS: {
      if (payload.action === 'add') {
        const added = await addPrompts(payload.texts);
        return { success: true, data: added };
      }
      if (payload.action === 'set_common') {
        await setCommonPrompt(payload.text);
        return { success: true };
      }
      if (payload.action === 'update') {
        const updated = await updatePrompt(payload.id, payload.text);
        return { success: true, data: updated };
      }
      if (payload.action === 'delete') {
        await deletePrompt(payload.id);
        return { success: true };
      }
      if (payload.action === 'reorder') {
        await reorderPrompts(payload.orderedIds);
        return { success: true };
      }
      if (payload.action === 'clear') {
        await clearAllPrompts();
        return { success: true };
      }
      return { success: false, error: 'Unknown prompt action' };
    }

    // --- Config management ---
    case MessageType.GET_CONFIG:
      return { success: true, data: await getConfig() };

    case MessageType.SAVE_CONFIG: {
      const updated = await updateConfig(payload.config);
      return { success: true, data: updated };
    }

    // --- Batch control ---
    case MessageType.START_BATCH: {
      const data = await getPrompts();
      const prompts = data.list;
      if (prompts.length === 0) {
        return { success: false, error: 'No prompts to process' };
      }
      // Find the Google Flow tab
      const tabId = await findFlowTab();
      if (!tabId) {
        return { success: false, error: 'Google Flow tab not found' };
      }
      await startBatch(data, tabId);
      return { success: true };
    }

    case MessageType.PAUSE_BATCH:
      await pauseBatch();
      return { success: true };

    case MessageType.RESUME_BATCH:
      await resumeBatch();
      return { success: true };

    case MessageType.CANCEL_BATCH:
      await cancelBatch();
      return { success: true };

    case MessageType.GET_BATCH_STATE:
      return { success: true, data: getBatchState() };

    // --- History ---
    case MessageType.GET_HISTORY: {
      const history = await getHistory(payload.limit);
      const usage = await getStorageUsage();
      return { success: true, data: { history, storageUsage: usage } };
    }

    case MessageType.DELETE_HISTORY:
      await deleteBatchRecord(payload.batchId);
      return { success: true };

    case MessageType.CLEAR_HISTORY:
      await clearHistory();
      return { success: true };

    // --- Content script results ---
    case MessageType.COMMAND_RESULT:
      await handleCommandResult(payload);
      return { success: true };

    // --- Connection check ---
    case MessageType.PING:
      return { success: true, type: MessageType.PONG };

    case MessageType.CONNECTION_STATUS:
      return { success: true, data: { connected: true } };

    default:
      console.warn('[ServiceWorker] Unknown message type:', type);
      return { success: false, error: `Unknown message type: ${type}` };
  }
}

/**
 * Find the active Google Flow tab
 * @returns {Promise<number|null>}
 */
async function findFlowTab() {
  const tabs = await chrome.tabs.query({
    url: 'https://labs.google/*',
    active: true,
    currentWindow: true,
  });

  if (tabs.length > 0) return tabs[0].id;

  // Fallback: any Google Flow tab
  const allFlowTabs = await chrome.tabs.query({
    url: 'https://labs.google/*',
  });
  return allFlowTabs.length > 0 ? allFlowTabs[0].id : null;
}

/**
 * Broadcast message to side panel via runtime message
 */
function broadcastToSidePanel(type, payload) {
  chrome.runtime.sendMessage(
    createMessage(type, payload, MessageSource.SERVICE_WORKER)
  ).catch(() => {
    // Side panel may not be open — ignore
  });
}
