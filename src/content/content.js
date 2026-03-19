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
        console.log(`[ContentScript] Executing prompt: "${promptText.substring(0, 50)}..."`);

        // Read frame image from storage if needed (too large for message)
        let firstFrameImage = null;
        if (hasFrameImage) {
          const result = await chrome.storage.local.get('current_frame_image');
          firstFrameImage = result.current_frame_image || null;
        }

        // Run automation async — DON'T await here (channel would timeout)
        runAutomationAsync(promptText, firstFrameImage, options || {});

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
   * Run automation asynchronously and send result back when done
   */
  async function runAutomationAsync(promptText, firstFrameImage, options) {
    try {
      const result = await automator.executeFullPromptCycle(promptText, firstFrameImage, options);
      console.log('[ContentScript] Automation result:', result.success ? 'SUCCESS' : result.error);

      safeSendMessage({
        type: 'COMMAND_RESULT',
        payload: result,
        timestamp: Date.now(),
        source: 'content-script',
      });
    } catch (err) {
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
