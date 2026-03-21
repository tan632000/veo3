/**
 * Content Script — Entry point for Google Flow page interaction
 */

// Guard against double injection
if (!window.__VEO3_CONTENT_LOADED) {
  window.__VEO3_CONTENT_LOADED = true;

(function() {
  'use strict';

  const automator = window.__VEO3_FLOW_AUTOMATOR;
  const selectors = window.__VEO3_SELECTORS;

  if (!automator || !selectors) {
    console.error('[ContentScript] Dependencies not loaded');
    return;
  }

  console.log('[ContentScript] Veo3 Bulk Video — Content script loaded on', window.location.href);

  /**
   * Run generation counter — prevents stale parallel runs from sending results.
   * Each new EXECUTE_COMMAND increments this. Old runs check before sending.
   */
  let currentRunId = 0;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch(err => {
        console.error('[ContentScript] Error handling message:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  });

  async function handleMessage(message) {
    const { type, payload } = message;

    switch (type) {
      case 'PING':
        return {
          success: true,
          type: 'PONG',
          data: { pageState: automator.getPageState() },
        };

      case 'CONNECTION_STATUS':
        return {
          success: true,
          data: {
            pageState: automator.getPageState(),
            url: window.location.href,
            selectorsValid: selectors.validateSelectors(),
          },
        };

      case 'EXECUTE_COMMAND': {
        const { promptText, hasFrameImage, options } = payload;

        // Increment run ID — any previous run will detect this and discard its result
        const myRunId = ++currentRunId;
        console.log(`[ContentScript] Executing prompt (runId=${myRunId}): "${promptText.substring(0, 50)}..."`);

        // Read frame image from storage if needed (too large for message)
        let firstFrameImage = null;
        if (hasFrameImage) {
          const result = await chrome.storage.local.get('current_frame_image');
          firstFrameImage = result.current_frame_image || null;
        }

        // Run automation async — DON'T await here (channel would timeout)
        runAutomationAsync(myRunId, promptText, firstFrameImage, options || {});

        // Immediately return acknowledgment
        return { success: true, data: { acknowledged: true } };
      }

      default:
        return { success: false, error: `Unknown command: ${type}` };
    }
  }

  /**
   * Safely send message — chrome.runtime can become undefined if extension reloads
   */
  function safeSendMessage(msg) {
    try {
      if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        return chrome.runtime.sendMessage(msg).catch(() => {});
      }
    } catch {
      console.warn('[ContentScript] Extension context invalidated');
    }
    return Promise.resolve();
  }

  /**
   * Run automation asynchronously and send result back when done.
   * Checks runId before sending result — if a newer run has started,
   * this run's result is stale and gets discarded.
   */
  async function runAutomationAsync(myRunId, promptText, firstFrameImage, options) {
    try {
      const result = await automator.executeFullPromptCycle(promptText, firstFrameImage, options);

      // Check if this run has been superseded by a newer one
      if (myRunId !== currentRunId) {
        console.log(`[ContentScript] ⏭️ Run ${myRunId} superseded by run ${currentRunId}, discarding result`);
        return;
      }

      console.log(`[ContentScript] Automation result (runId=${myRunId}):`, result.success ? 'SUCCESS' : result.error);

      safeSendMessage({
        type: 'COMMAND_RESULT',
        payload: result,
        timestamp: Date.now(),
        source: 'content-script',
      });
    } catch (err) {
      // Check if superseded before sending error
      if (myRunId !== currentRunId) {
        console.log(`[ContentScript] ⏭️ Run ${myRunId} superseded (error path), discarding`);
        return;
      }

      console.error('[ContentScript] Automation error:', err);
      safeSendMessage({
        type: 'COMMAND_RESULT',
        payload: { success: false, error: err.message },
        timestamp: Date.now(),
        source: 'content-script',
      });
    }
  }

  safeSendMessage({
    type: 'CONNECTION_STATUS',
    payload: {
      connected: true,
      pageState: automator.getPageState(),
      url: window.location.href,
    },
    timestamp: Date.now(),
    source: 'content-script',
  });

})();

} // end guard
