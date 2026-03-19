/**
 * PromptManager — CRUD operations for prompt list
 * Storage key: prompts_list
 */

import { StorageKeys, storageGet, storageSet } from '../shared/storage.js';

/**
 * Get all prompts from storage
 * @returns {Promise<{common: string, list: Array<{id: string, text: string, order: number, createdAt: number}>}>}
 */
export async function getPrompts() {
  const data = await storageGet(StorageKeys.PROMPTS_LIST);
  if (!data) return { common: '', list: [] };
  if (Array.isArray(data)) return { common: '', list: data }; // legacy migration
  return data;
}

/**
 * Add multiple prompts from text (split by newline)
 * @param {string[]} texts - Array of prompt texts
 * @returns {Promise<Array>} Created prompt items
 */
export async function addPrompts(texts) {
  const data = await getPrompts();
  const existing = data.list;
  const maxOrder = existing.length > 0
    ? Math.max(...existing.map(p => p.order))
    : -1;

  const newPrompts = texts
    .map(t => t.trim())
    .filter(t => t.length > 0)
    .map((text, i) => ({
      id: crypto.randomUUID(),
      text,
      order: maxOrder + 1 + i,
      createdAt: Date.now(),
    }));

  const updated = [...existing, ...newPrompts];
  data.list = updated;
  await storageSet(StorageKeys.PROMPTS_LIST, data);
  return newPrompts;
}

/**
 * Update a prompt's text
 * @param {string} id
 * @param {string} text
 * @returns {Promise<object|null>}
 */
export async function updatePrompt(id, text) {
  const data = await getPrompts();
  const prompts = data.list;
  const idx = prompts.findIndex(p => p.id === id);
  if (idx === -1) return null;

  prompts[idx].text = text.trim();
  data.list = prompts;
  await storageSet(StorageKeys.PROMPTS_LIST, data);
  return prompts[idx];
}

/**
 * Delete a prompt by id
 * @param {string} id
 */
export async function deletePrompt(id) {
  const data = await getPrompts();
  const prompts = data.list;
  const filtered = prompts.filter(p => p.id !== id);
  // Re-order
  filtered.forEach((p, i) => { p.order = i; });
  data.list = filtered;
  await storageSet(StorageKeys.PROMPTS_LIST, data);
}

/**
 * Reorder prompts by providing ordered list of ids
 * @param {string[]} orderedIds
 */
export async function reorderPrompts(orderedIds) {
  const data = await getPrompts();
  const prompts = data.list;
  const map = new Map(prompts.map(p => [p.id, p]));
  const reordered = orderedIds
    .filter(id => map.has(id))
    .map((id, i) => {
      const p = map.get(id);
      p.order = i;
      return p;
    });
  data.list = reordered;
  await storageSet(StorageKeys.PROMPTS_LIST, data);
}

/**
 * Clear all prompts
 */
export async function clearAllPrompts() {
  const data = await getPrompts();
  data.list = [];
  await storageSet(StorageKeys.PROMPTS_LIST, data);
}

/**
 * Save common prompt text
 * @param {string} text
 */
export async function setCommonPrompt(text) {
  const data = await getPrompts();
  data.common = text;
  await storageSet(StorageKeys.PROMPTS_LIST, data);
}
