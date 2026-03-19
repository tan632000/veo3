/**
 * HistoryManager — Batch history storage and queries
 * Storage key: batch_history
 */

import { StorageKeys, storageGet, storageSet, getStorageUsage } from '../shared/storage.js';

const MAX_HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const STORAGE_CLEANUP_THRESHOLD = 8 * 1024 * 1024; // 8MB

/**
 * Save a completed batch record
 * @param {object} record - IBatchRecord
 */
export async function saveBatchRecord(record) {
  const history = await getHistory();
  history.unshift(record); // newest first
  await storageSet(StorageKeys.BATCH_HISTORY, history);
  await autoCleanup();
}

/**
 * Get batch history
 * @param {number} [limit] - Max records to return
 * @returns {Promise<Array>}
 */
export async function getHistory(limit) {
  const history = await storageGet(StorageKeys.BATCH_HISTORY);
  const list = history || [];
  return limit ? list.slice(0, limit) : list;
}

/**
 * Delete a specific batch record
 * @param {string} batchId
 */
export async function deleteBatchRecord(batchId) {
  const history = await getHistory();
  const filtered = history.filter(r => r.batchId !== batchId);
  await storageSet(StorageKeys.BATCH_HISTORY, filtered);
}

/**
 * Clear all history
 */
export async function clearHistory() {
  await storageSet(StorageKeys.BATCH_HISTORY, []);
}

/**
 * Get storage usage info
 * @returns {Promise<{used: number, total: number}>}
 */
export { getStorageUsage };

/**
 * Auto-cleanup old records when storage exceeds threshold
 */
async function autoCleanup() {
  const usage = await getStorageUsage();
  if (usage.used < STORAGE_CLEANUP_THRESHOLD) return;

  const history = await getHistory();
  const now = Date.now();
  const filtered = history.filter(r => (now - r.completedAt) < MAX_HISTORY_AGE_MS);

  if (filtered.length < history.length) {
    await storageSet(StorageKeys.BATCH_HISTORY, filtered);
  }
}
