/**
 * ConfigManager — Batch configuration management
 * Storage key: batch_config
 */

import { StorageKeys, storageGet, storageSet } from '../shared/storage.js';

const DEFAULT_CONFIG = {
  firstFrameImage: null,
  aspectRatio: '16:9',
  useLowerPriority: true,
  delayBetweenGenerations: 3000,
  maxRetries: 3,
  skipOnError: true,
};

/**
 * Get current batch config (merged with defaults)
 * @returns {Promise<object>}
 */
export async function getConfig() {
  const saved = await storageGet(StorageKeys.BATCH_CONFIG);
  return { ...DEFAULT_CONFIG, ...(saved || {}) };
}

/**
 * Update config with partial values
 * @param {object} partial
 * @returns {Promise<object>} Updated full config
 */
export async function updateConfig(partial) {
  const current = await getConfig();
  const updated = { ...current, ...partial };
  await storageSet(StorageKeys.BATCH_CONFIG, updated);
  return updated;
}

/**
 * Reset config to defaults
 * @returns {Promise<object>}
 */
export async function resetConfig() {
  await storageSet(StorageKeys.BATCH_CONFIG, DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG };
}
