/**
 * ErrorLogger — Error logging with auto-cleanup
 * Storage key: error_logs
 */

import { StorageKeys, storageGet, storageSet } from '../shared/storage.js';

const MAX_ERROR_LOGS = 500;

/**
 * Log an error
 * @param {object} params
 * @param {string} params.batchId
 * @param {string|null} params.promptId
 * @param {'user'|'system'|'business'} params.category
 * @param {string} params.message
 * @param {object} [params.context]
 */
export async function logError({ batchId, promptId = null, category, message, context = {} }) {
  const logs = await getErrorLogs();

  logs.push({
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    batchId,
    promptId,
    category,
    message,
    context,
    resolved: false,
  });

  // Keep only latest MAX_ERROR_LOGS entries
  const trimmed = logs.length > MAX_ERROR_LOGS
    ? logs.slice(logs.length - MAX_ERROR_LOGS)
    : logs;

  await storageSet(StorageKeys.ERROR_LOGS, trimmed);
}

/**
 * Get all error logs
 * @returns {Promise<Array>}
 */
export async function getErrorLogs() {
  const logs = await storageGet(StorageKeys.ERROR_LOGS);
  return logs || [];
}

/**
 * Clear all error logs
 */
export async function clearErrorLogs() {
  await storageSet(StorageKeys.ERROR_LOGS, []);
}
