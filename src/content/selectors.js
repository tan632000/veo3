/**
 * SelectorMap — Centralized CSS selectors for Google Flow page
 * Based on actual DOM inspection of labs.google/fx/vi/tools/flow
 */

// Guard against double injection
if (!window.__VEO3_SELECTORS) {

(function() {
  'use strict';

  const SELECTORS = {
    // Prompt input — Slate.js editor (contenteditable div with data-slate-editor)
    promptInput: [
      'div[data-slate-editor="true"][contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
      '[contenteditable="true"].sc-74ba1bc0-5',
      'div[contenteditable="true"]',
    ],

    // Generate/Create button ("Tạo") — submit button
    generateButton: [
      'button[type="submit"].sc-74ba1bc0-4',
      'button.sc-74ba1bc0-4',
    ],

    // Image file upload input
    imageUploadInput: [
      'input[type="file"][accept="image/*"]',
      'input[type="file"].sc-a40aa0db-0',
      'input[type="file"]',
    ],

    // Mode tabs — Video, Hình ảnh, Khung hình, Thành phần
    videoModeTab: [
      'button[role="tab"][id$="VIDEO"]',
    ],
    imageModeTab: [
      'button[role="tab"][id$="IMAGE"]',
    ],

    // Aspect ratio tabs
    portraitTab: [
      'button[role="tab"][id$="PORTRAIT"]',
    ],
    landscapeTab: [
      'button[role="tab"][id$="LANDSCAPE"]',
    ],

    // Quantity tabs
    quantityX1: ['button[role="tab"][id$="trigger-1"]'],
    quantityX2: ['button[role="tab"][id$="trigger-2"]'],
    quantityX3: ['button[role="tab"][id$="trigger-3"]'],
    quantityX4: ['button[role="tab"][id$="trigger-4"]'],

    // Model selector dropdown trigger
    modelSelectorTrigger: [
      'button.sc-a0dcecfb-1',
    ],

    // Model menu items (visible after opening dropdown)
    modelMenuItem: [
      'div[role="menuitem"] button',
      '[role="menuitem"]',
    ],

    // Result detection — video elements
    resultVideoElement: [
      'video[src]',
      'video',
    ],

    // Error detection
    errorMessage: [
      '[role="alert"]:not(:empty)',
    ],

    // Loading state
    loadingIndicator: [
      '[role="progressbar"]',
      '.spinner',
    ],
  };

  function findElement(key, root = document) {
    const alternatives = SELECTORS[key];
    if (!alternatives) {
      console.warn(`[Selectors] Unknown selector key: ${key}`);
      return null;
    }
    for (const selector of alternatives) {
      try {
        const el = root.querySelector(selector);
        if (el) return el;
      } catch { /* invalid selector, skip */ }
    }
    return null;
  }

  function findAllElements(key, root = document) {
    const alternatives = SELECTORS[key];
    if (!alternatives) return [];
    for (const selector of alternatives) {
      try {
        const els = root.querySelectorAll(selector);
        if (els.length > 0) return Array.from(els);
      } catch { /* invalid selector, skip */ }
    }
    return [];
  }

  function validateSelectors() {
    const critical = ['promptInput', 'generateButton'];
    const missing = critical.filter(key => !findElement(key));
    return { valid: missing.length === 0, missing };
  }

  window.__VEO3_SELECTORS = {
    SELECTORS,
    findElement,
    findAllElements,
    validateSelectors,
  };

})();

} // end guard
