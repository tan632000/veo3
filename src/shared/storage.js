/**
 * Chrome storage wrapper with typed keys
 */

export const StorageKeys = {
  PROMPTS_LIST: 'prompts_list',
  BATCH_CONFIG: 'batch_config',
  BATCH_STATE: 'batch_state',
  BATCH_HISTORY: 'batch_history',
  ERROR_LOGS: 'error_logs',
};

/**
 * Get a value from chrome.storage.local
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function storageGet(key) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

/**
 * Set a value in chrome.storage.local
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
export async function storageSet(key, value) {
  return chrome.storage.local.set({ [key]: value });
}

/**
 * Remove a key from chrome.storage.local
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function storageRemove(key) {
  return chrome.storage.local.remove(key);
}

/**
 * Get current storage usage in bytes
 * @returns {Promise<{used: number, total: number}>}
 */
export async function getStorageUsage() {
  const bytesInUse = await chrome.storage.local.getBytesInUse(null);
  return {
    used: bytesInUse,
    total: 10 * 1024 * 1024, // 10MB limit
  };
}
