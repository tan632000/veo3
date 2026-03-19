/**
 * Side Panel JS — UI logic for Veo3 Bulk Video extension
 * Communicates with Service Worker for all data operations
 */

(function () {
  'use strict';

  // --- Constants ---
  const DEFAULT_SLOT_COUNT = 10;

  // --- State ---
  let currentView = 'prompts';
  let promptSlots = []; // Array of {id, text} — always has at least DEFAULT_SLOT_COUNT entries
  let commonPromptText = ''; // Stores the common prompt text
  let config = {};
  let batchState = null;
  let connectionStatus = 'disconnected';

  // --- DOM References ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // --- Message Helpers ---
  async function sendMessage(type, payload = {}) {
    try {
      return await chrome.runtime.sendMessage({
        type,
        payload,
        timestamp: Date.now(),
        source: 'side-panel',
      });
    } catch (err) {
      console.error('[SidePanel] Send error:', err);
      return { success: false, error: err.message };
    }
  }

  // --- Initialization ---
  async function init() {
    setupTabs();
    setupPromptHandlers();
    setupConfigHandlers();
    setupProgressHandlers();
    setupHistoryHandlers();
    setupMessageListener();

    await loadPrompts();
    await loadConfig();
    await loadBatchState();
    checkConnection();

    // Periodic connection check
    setInterval(checkConnection, 5000);
  }

  // --- Tab Navigation ---
  function setupTabs() {
    $$('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        switchTab(target);
      });
    });
  }

  function switchTab(name) {
    currentView = name;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${name}`));

    // Only load state that might have been changed by background process
    if (name === 'progress') loadBatchState();
    if (name === 'history') loadHistory();
  }

  // --- Connection Status ---
  async function checkConnection() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || !tab.url.includes('labs.google/')) {
        setConnectionStatus('not-flow-page');
        return;
      }

      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'PING',
          payload: {},
          timestamp: Date.now(),
          source: 'side-panel',
        });

        if (response && response.success) {
          setConnectionStatus('connected');
        } else {
          setConnectionStatus('disconnected');
        }
      } catch {
        // Content script not loaded yet — inject it programmatically
        console.log('[SidePanel] Content script not found, injecting...');
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [
              'src/content/selectors.js',
              'src/content/frame-extractor.js',
              'src/content/flow-automator.js',
              'src/content/content.js',
            ],
          });
          // Wait a moment then try ping again
          await new Promise(r => setTimeout(r, 500));
          const retryRes = await chrome.tabs.sendMessage(tab.id, {
            type: 'PING', payload: {}, timestamp: Date.now(), source: 'side-panel',
          });
          setConnectionStatus(retryRes && retryRes.success ? 'connected' : 'disconnected');
        } catch {
          setConnectionStatus('disconnected');
        }
      }
    } catch {
      setConnectionStatus('disconnected');
    }
  }

  function setConnectionStatus(status) {
    connectionStatus = status;
    const badge = $('#connectionBadge');
    const dot = badge.querySelector('.badge-dot');
    const text = badge.querySelector('.badge-text');

    dot.className = 'badge-dot ' + status;
    const labels = {
      connected: 'Connected',
      disconnected: 'Disconnected',
      'not-flow-page': 'Not on Flow',
    };
    text.textContent = labels[status] || status;

    updateStartBtnState();
  }

  function updateStartBtnState() {
    const startBtn = $('#startBatchBtn');
    if (startBtn) {
      const filledCount = promptSlots.filter(s => s.text.trim()).length;
      startBtn.disabled = connectionStatus !== 'connected' || filledCount === 0;
    }
  }

  // ========================
  // === PROMPTS (INPUT FIELDS) ===
  // ========================

  async function loadPrompts() {
    const res = await sendMessage('GET_PROMPTS');
    // Assuming backend will be updated to store { common: string, list: [] }
    // Or we handle common prompt separately. Let's store common prompt in config or handle it via a new message,
    // wait, GET_PROMPTS currently just returns an array. Let's adapt GET_PROMPTS in background to return an object.
    const data = res && res.success ? res.data : { common: '', list: [] };
    const saved = Array.isArray(data) ? data : (data.list || []);
    
    commonPromptText = Array.isArray(data) ? '' : (data.common || '');
    $('#commonPromptInput').value = commonPromptText;
    
    // Build slots from saved prompts
    promptSlots = saved.map(p => ({ id: p.id, text: p.text || '' }));

    // Pad to minimum DEFAULT_SLOT_COUNT with empty slots
    const slotsToAdd = DEFAULT_SLOT_COUNT - promptSlots.length;
    for (let i = 0; i < slotsToAdd; i++) {
      promptSlots.push({ id: null, text: '' });
    }

    renderPromptInputs();
    updatePromptBadge();
  }

  function renderPromptInputs() {
    const container = $('#promptInputList');
    container.innerHTML = promptSlots.map((slot, i) => `
      <div class="prompt-input-row" data-index="${i}">
        <span class="prompt-order">${i + 1}</span>
        <textarea class="prompt-field${slot.text.trim() ? ' has-value' : ''}"
               placeholder="Nhập prompt video #${i + 1}..."
               rows="3"
               data-index="${i}">${escapeHtml(slot.text)}</textarea>
        <button class="remove-btn" data-index="${i}" title="Xóa">✕</button>
      </div>
    `).join('');

    // Bind events
    $('#commonPromptInput').addEventListener('input', (e) => {
      commonPromptText = e.target.value;
      debouncedSavePrompts();
    });

    container.querySelectorAll('.prompt-field').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index);
        promptSlots[idx].text = e.target.value;
        e.target.classList.toggle('has-value', e.target.value.trim().length > 0);
        updatePromptBadge();
        debouncedSavePrompts();
      });
    });

    container.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index);
        // Only remove if more than DEFAULT_SLOT_COUNT slots exist
        if (promptSlots.length > DEFAULT_SLOT_COUNT) {
          promptSlots.splice(idx, 1);
        } else {
          // Just clear the text
          promptSlots[idx].text = '';
          promptSlots[idx].id = null;
        }
        renderPromptInputs();
        updatePromptBadge();
        debouncedSavePrompts();
      });
    });
  }

  function updatePromptBadge() {
    const filledCount = promptSlots.filter(s => s.text.trim()).length;
    const badge = $('#promptCountBadge');
    const count = $('#promptListCount');
    badge.textContent = filledCount;
    badge.style.display = filledCount > 0 ? '' : 'none';
    count.textContent = filledCount;
    updateStartBtnState();
  }

  // Debounce save to avoid excessive writes
  let saveTimeout = null;
  function debouncedSavePrompts() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(savePromptsToStorage, 500);
  }

  async function savePromptsToStorage() {
    // Save common prompt
    await sendMessage('SAVE_PROMPTS', { action: 'set_common', text: commonPromptText });

    // Clear all existing, then add non-empty prompts
    await sendMessage('SAVE_PROMPTS', { action: 'clear' });

    const nonEmpty = promptSlots
      .filter(s => s.text.trim())
      .map(s => s.text.trim());

    if (nonEmpty.length > 0) {
      await sendMessage('SAVE_PROMPTS', { action: 'add', texts: nonEmpty });
    }
  }

  function setupPromptHandlers() {
    $('#addMorePromptsBtn').addEventListener('click', () => {
      // Add 5 more empty slots
      for (let i = 0; i < 5; i++) {
        promptSlots.push({ id: null, text: '' });
      }
      renderPromptInputs();

      // Scroll to bottom and focus new input
      const container = $('#promptInputList');
      container.scrollTop = container.scrollHeight;
      const lastInput = container.querySelector('.prompt-input-row:last-child .prompt-field');
      if (lastInput) lastInput.focus();
    });

    $('#clearPromptsBtn').addEventListener('click', async () => {
      if (!confirm('Xóa tất cả prompts?')) return;
      promptSlots = [];
      for (let i = 0; i < DEFAULT_SLOT_COUNT; i++) {
        promptSlots.push({ id: null, text: '' });
      }
      renderPromptInputs();
      updatePromptBadge();
      await sendMessage('SAVE_PROMPTS', { action: 'clear' });
    });
  }

  // --- Config ---
  async function loadConfig() {
    const res = await sendMessage('GET_CONFIG');
    if (res.success) {
      config = res.data;
      applyConfigToUI(config);
    }
  }

  function applyConfigToUI(cfg) {
    $('#aspectRatio').value = cfg.aspectRatio || '16:9';
    $('#delayInput').value = cfg.delayBetweenGenerations || 3000;
    $('#maxRetriesInput').value = cfg.maxRetries || 3;
    $('#useLowerPriorityInput').checked = cfg.useLowerPriority !== false;
    $('#skipOnErrorInput').checked = cfg.skipOnError !== false;
    $('#extractLastFrameInput').checked = !!cfg.extractLastFrame;

    if (cfg.firstFrameImage) {
      $('#previewImage').src = cfg.firstFrameImage;
      $('#uploadPlaceholder').style.display = 'none';
      $('#uploadPreview').style.display = '';
    } else {
      $('#uploadPlaceholder').style.display = '';
      $('#uploadPreview').style.display = 'none';
    }
  }

  function setupConfigHandlers() {
    const zone = $('#uploadZone');
    const input = $('#firstFrameInput');

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; });
    zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.style.borderColor = '';
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) handleImageFile(file);
    });

    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleImageFile(file);
    });

    $('#removeImageBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      config.firstFrameImage = null;
      applyConfigToUI(config);
      saveConfig();
    });

    $('#saveConfigBtn').addEventListener('click', saveConfig);
  }

  function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      config.firstFrameImage = e.target.result;
      applyConfigToUI(config);
    };
    reader.readAsDataURL(file);
  }

  async function saveConfig() {
    const cfg = {
      firstFrameImage: config.firstFrameImage || null,
      aspectRatio: $('#aspectRatio').value,
      useLowerPriority: $('#useLowerPriorityInput').checked,
      delayBetweenGenerations: parseInt($('#delayInput').value) || 3000,
      maxRetries: parseInt($('#maxRetriesInput').value) || 3,
      skipOnError: $('#skipOnErrorInput').checked,
      extractLastFrame: $('#extractLastFrameInput').checked,
    };

    const res = await sendMessage('SAVE_CONFIG', { config: cfg });
    if (res.success) {
      config = res.data;
      showToast('Cấu hình đã lưu!');
    }
  }

  // --- Progress ---
  async function loadBatchState() {
    const res = await sendMessage('GET_BATCH_STATE');
    if (res.success && res.data) {
      batchState = res.data;
      renderProgressState(batchState);
    } else {
      renderProgressState(null);
    }
  }

  function renderProgressState(state) {
    const idle = $('#progressIdle');
    const running = $('#progressRunning');
    const paused = $('#progressPaused');
    const completed = $('#progressCompleted');

    [idle, running, paused, completed].forEach(el => el.style.display = 'none');

    if (!state || state.status === 'idle') {
      idle.style.display = '';
      return;
    }

    if (state.status === 'running') {
      running.style.display = '';
      updateProgressUI(state);
      renderProgressPromptList(state);
      return;
    }

    if (state.status === 'paused') {
      paused.style.display = '';
      const total = state.prompts.length;
      const done = state.prompts.filter(p => p.status === 'completed' || p.status === 'error').length;
      $('#pausedCount').textContent = `${done}/${total}`;
      $('#pausedBar').style.width = `${(done / total) * 100}%`;
      return;
    }

    if (state.status === 'completed' || state.status === 'cancelled') {
      completed.style.display = '';
      const sc = state.prompts.filter(p => p.status === 'completed').length;
      const ec = state.prompts.filter(p => p.status === 'error').length;
      $('#successCount').textContent = sc;
      $('#errorCount').textContent = ec;

      const duration = ((state.completedAt || Date.now()) - state.startedAt) / 1000;
      $('#totalTime').textContent = formatDuration(duration);
      return;
    }
  }

  function updateProgressUI(state) {
    const total = state.prompts.length;
    const done = state.prompts.filter(p => p.status === 'completed' || p.status === 'error').length;
    const pct = total > 0 ? (done / total) * 100 : 0;

    $('#progressCount').textContent = `${done}/${total}`;
    $('#progressBar').style.width = `${pct}%`;

    const current = state.prompts[state.currentIndex];
    if (current) {
      $('#progressStatus').textContent = `Đang xử lý: "${current.text.substring(0, 60)}..."`;
    }
  }

  function renderProgressPromptList(state) {
    const container = $('#progressPromptList');
    container.innerHTML = state.prompts.map(p => `
      <div class="prompt-item">
        <span class="status-icon">${getStatusIcon(p.status)}</span>
        <span class="prompt-text status-${p.status}">${escapeHtml(p.text)}</span>
        ${p.error ? `<span class="error-hint" title="${escapeAttr(p.error)}">⚠️</span>` : ''}
      </div>
    `).join('');
  }

  function setupProgressHandlers() {
    $('#startBatchBtn').addEventListener('click', async () => {
      // Save prompts first to ensure storage is up to date
      await savePromptsToStorage();
      const res = await sendMessage('START_BATCH');
      if (res.success) {
        switchTab('progress');
        loadBatchState();
      } else {
        showToast(res.error || 'Failed to start batch', true);
      }
    });

    $('#pauseBtn').addEventListener('click', () => sendMessage('PAUSE_BATCH').then(loadBatchState));
    $('#cancelBtn').addEventListener('click', () => {
      if (confirm('Hủy batch hiện tại?')) sendMessage('CANCEL_BATCH').then(loadBatchState);
    });
    $('#resumeBtn').addEventListener('click', () => sendMessage('RESUME_BATCH').then(loadBatchState));
    $('#cancelPausedBtn').addEventListener('click', () => {
      if (confirm('Hủy batch hiện tại?')) sendMessage('CANCEL_BATCH').then(loadBatchState);
    });
    $('#newBatchBtn').addEventListener('click', () => {
      batchState = null;
      renderProgressState(null);
    });
  }

  // --- History ---
  async function loadHistory() {
    const res = await sendMessage('GET_HISTORY', { limit: 20 });
    if (res.success) {
      renderHistoryList(res.data.history || []);
      const usage = res.data.storageUsage;
      if (usage) {
        $('#storageUsed').textContent = (usage.used / (1024 * 1024)).toFixed(1);
        $('#storageTotal').textContent = (usage.total / (1024 * 1024)).toFixed(0);
      }
    }
  }

  function renderHistoryList(history) {
    const container = $('#historyList');

    if (history.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📋</span>
          <p>Chưa có lịch sử batch nào.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = history.map(h => `
      <div class="history-item" data-id="${h.batchId}">
        <div class="history-item-header">
          <span class="history-item-date">${formatDate(h.startedAt)}</span>
          <button class="action-btn delete" data-id="${h.batchId}" title="Delete">🗑️</button>
        </div>
        <div class="history-item-stats">
          <span class="stat-success">✅ ${h.successCount}</span>
          <span class="stat-error">❌ ${h.errorCount}</span>
          <span>${h.prompts.length} prompts</span>
          <span>${formatDuration(((h.completedAt || 0) - h.startedAt) / 1000)}</span>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.action-btn.delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await sendMessage('DELETE_HISTORY', { batchId: btn.dataset.id });
        loadHistory();
      });
    });
  }

  function setupHistoryHandlers() {
    $('#clearHistoryBtn').addEventListener('click', async () => {
      if (!confirm('Xóa tất cả lịch sử?')) return;
      await sendMessage('CLEAR_HISTORY');
      loadHistory();
    });
  }

  // --- Message Listener (from Service Worker updates) ---
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.source !== 'service-worker') return;

      if (message.type === 'STATE_UPDATE' && message.payload.state) {
        batchState = message.payload.state;
        if (currentView === 'progress') {
          renderProgressState(batchState);
        }
      }
    });
  }

  // --- Utilities ---
  function getStatusIcon(status) {
    const icons = {
      pending: '⏳',
      generating: '🔄',
      completed: '✅',
      error: '❌',
      skipped: '⏭️',
    };
    return icons[status] || '⏳';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function formatDuration(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }

  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      padding: 8px 16px; border-radius: 8px; font-size: 12px; z-index: 100;
      background: ${isError ? 'var(--danger)' : 'var(--accent)'}; color: white;
      box-shadow: var(--shadow); animation: fadeIn 0.2s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // --- Start ---
  document.addEventListener('DOMContentLoaded', init);

})();
