/**
 * Message passing protocol for communication between
 * Service Worker ↔ Content Script ↔ Side Panel
 */

// Message types enum
export const MessageType = {
  // Batch control
  START_BATCH: 'START_BATCH',
  PAUSE_BATCH: 'PAUSE_BATCH',
  RESUME_BATCH: 'RESUME_BATCH',
  CANCEL_BATCH: 'CANCEL_BATCH',

  // Content script commands
  EXECUTE_COMMAND: 'EXECUTE_COMMAND',
  COMMAND_RESULT: 'COMMAND_RESULT',

  // State & progress
  STATE_UPDATE: 'STATE_UPDATE',
  PROGRESS_UPDATE: 'PROGRESS_UPDATE',
  BATCH_COMPLETE: 'BATCH_COMPLETE',

  // Error
  ERROR: 'ERROR',

  // Connection
  PING: 'PING',
  PONG: 'PONG',
  CONNECTION_STATUS: 'CONNECTION_STATUS',

  // Data sync
  GET_PROMPTS: 'GET_PROMPTS',
  SAVE_PROMPTS: 'SAVE_PROMPTS',
  GET_CONFIG: 'GET_CONFIG',
  SAVE_CONFIG: 'SAVE_CONFIG',
  GET_BATCH_STATE: 'GET_BATCH_STATE',
  GET_HISTORY: 'GET_HISTORY',
  DELETE_HISTORY: 'DELETE_HISTORY',
  CLEAR_HISTORY: 'CLEAR_HISTORY',
};

// Message sources
export const MessageSource = {
  SIDE_PANEL: 'side-panel',
  SERVICE_WORKER: 'service-worker',
  CONTENT_SCRIPT: 'content-script',
};

/**
 * Create a standardized extension message
 * @param {string} type - MessageType value
 * @param {object} payload - Message data
 * @param {string} source - MessageSource value
 * @returns {object} Formatted message
 */
export function createMessage(type, payload = {}, source) {
  return {
    type,
    payload,
    timestamp: Date.now(),
    source,
  };
}

/**
 * Send message to the service worker (background)
 * Used by Side Panel and Content Script
 * @param {string} type
 * @param {object} payload
 * @param {string} source
 * @returns {Promise<any>}
 */
export function sendToBackground(type, payload = {}, source) {
  return chrome.runtime.sendMessage(createMessage(type, payload, source));
}

/**
 * Send message to a specific tab's content script
 * Used by Service Worker
 * @param {number} tabId
 * @param {string} type
 * @param {object} payload
 * @returns {Promise<any>}
 */
export function sendToContentScript(tabId, type, payload = {}) {
  return chrome.tabs.sendMessage(
    tabId,
    createMessage(type, payload, MessageSource.SERVICE_WORKER)
  );
}
