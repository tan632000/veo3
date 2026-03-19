/**
 * FlowAutomator — DOM automation for Google Flow page
 * Updated with real selectors from DOM inspection
 */

// Guard against double injection
if (!window.__VEO3_FLOW_AUTOMATOR) {

  (function () {
    'use strict';

    const { findElement, findAllElements } = window.__VEO3_SELECTORS || {};
    const { extractLastFrame } = window.__VEO3_FRAME_EXTRACTOR || {};

    function waitForElement(selectorKey, timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        const el = findElement(selectorKey);
        if (el) return resolve(el);

        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error(`Element "${selectorKey}" not found within ${timeoutMs}ms`));
        }, timeoutMs);

        const observer = new MutationObserver(() => {
          const el = findElement(selectorKey);
          if (el) {
            observer.disconnect();
            clearTimeout(timeout);
            resolve(el);
          }
        });

        observer.observe(document.body, { childList: true, subtree: true });
      });
    }

    /**
     * Select "Video" mode tab
     */
    async function selectVideoMode() {
      try {
        const tab = findElement('videoModeTab');
        if (tab) {
          const isActive = tab.getAttribute('data-state') === 'active' || tab.getAttribute('aria-selected') === 'true';
          if (!isActive) {
            tab.click();
            await delay(500);
            console.log('[FlowAutomator] Selected Video mode');
          } else {
            console.log('[FlowAutomator] Video mode already active');
          }
        }
        return { success: true, data: null, error: null };
      } catch (err) {
        return { success: false, data: null, error: `Video mode selection failed: ${err.message}` };
      }
    }

    /**
     * Select model — open dropdown and click "Fast [Lower Priority]" or "Fast"
     */
    async function selectModel(preferLowerPriority = true) {
      try {
        const trigger = findElement('modelSelectorTrigger');
        if (!trigger) {
          console.log('[FlowAutomator] Model selector not found, skipping');
          return { success: true, data: null, error: null };
        }

        // Check if already on the desired model
        const currentText = trigger.textContent.trim();
        if (preferLowerPriority && currentText.includes('Lower Priority')) {
          console.log('[FlowAutomator] Already on Fast [Lower Priority]');
          return { success: true, data: null, error: null };
        }
        if (!preferLowerPriority && currentText.includes('Fast') && !currentText.includes('Lower')) {
          console.log('[FlowAutomator] Already on Fast');
          return { success: true, data: null, error: null };
        }

        // Open dropdown
        trigger.click();
        await delay(500);

        // Find menu items
        const menuItems = findAllElements('modelMenuItem');
        const targetText = preferLowerPriority ? 'Lower Priority' : 'Fast';
        const targetItem = menuItems.find(item => {
          const text = item.textContent.trim();
          if (preferLowerPriority) return text.includes('Lower Priority');
          return text.includes('Fast') && !text.includes('Lower') && !text.includes('Quality');
        });

        if (targetItem) {
          targetItem.click();
          await delay(500);
          console.log(`[FlowAutomator] Selected model: ${targetItem.textContent.trim()}`);
        } else {
          // Close dropdown if item not found
          trigger.click();
          await delay(200);
          console.log('[FlowAutomator] Target model not found in dropdown');
        }

        return { success: true, data: null, error: null };
      } catch (err) {
        return { success: false, data: null, error: `Model selection failed: ${err.message}` };
      }
    }

    /**
     * Select aspect ratio
     * @param {'portrait'|'landscape'} ratio
     */
    async function selectAspectRatio(ratio = 'landscape') {
      try {
        const key = ratio === 'portrait' ? 'portraitTab' : 'landscapeTab';
        const tab = findElement(key);
        if (tab) {
          const isActive = tab.getAttribute('data-state') === 'active' || tab.getAttribute('aria-selected') === 'true';
          if (!isActive) {
            tab.click();
            await delay(300);
            console.log(`[FlowAutomator] Selected aspect ratio: ${ratio}`);
          }
        }
        return { success: true, data: null, error: null };
      } catch (err) {
        return { success: false, data: null, error: `Aspect ratio selection failed: ${err.message}` };
      }
    }

    /**
     * Upload image as first frame via the hidden file input
     * Gracefully skips if file input not found (batch continues without image)
     */
    async function uploadImage(base64DataUrl) {
      if (!base64DataUrl) return { success: true, data: null, error: null };

      console.log(`[FlowAutomator] Uploading first frame image (${(base64DataUrl.length / 1024).toFixed(0)}KB)...`);

      try {
        // Try to find file input directly
        let input = findElement('imageUploadInput');

        if (!input) {
          // Broad fallback search
          input = document.querySelector('input[type="file"]');
        }

        if (!input) {
          console.warn('[FlowAutomator] ⚠️ File input not found — skipping image upload. Video will generate without first frame.');
          return { success: true, data: null, error: null };
        }

        const response = await fetch(base64DataUrl);
        const blob = await response.blob();
        const file = new File([blob], 'first-frame.png', { type: 'image/png' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await delay(1500);
        console.log('[FlowAutomator] ✅ First frame image uploaded');
        return { success: true, data: null, error: null };
      } catch (err) {
        // Non-fatal — skip and continue
        console.warn(`[FlowAutomator] ⚠️ Image upload failed (non-fatal): ${err.message}`);
        return { success: true, data: null, error: null };
      }
    }

    /**
     * Fill the prompt — Google Flow uses React contenteditable div
     * Strategy: execCommand to insert text + trigger React via native events
     */
    async function fillPrompt(text) {
      const promptEl = await waitForElement('promptInput');

      // Focus the element
      promptEl.focus();
      await delay(200);

      // 1. Clear existing content
      document.execCommand('selectAll', false, null);
      await delay(50);
      document.execCommand('delete', false, null);
      await delay(100);

      // 2. Insert text using execCommand (puts text in DOM)
      document.execCommand('insertText', false, text);
      await delay(100);

      // 3. Trigger React state update via native events
      // React 16+ uses beforeinput + input for contenteditable
      promptEl.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
      }));

      promptEl.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text,
      }));

      // 4. Also try triggering React's internal onChange via fiber
      triggerReactChange(promptEl);

      await delay(300);
      console.log(`[FlowAutomator] Filled prompt: "${promptEl.textContent.substring(0, 50)}"`);
      return { success: true, data: null, error: null };
    }

    /**
     * Try to trigger React's internal change detection
     * React stores internal props on DOM elements via __reactFiber/__reactProps
     */
    function triggerReactChange(el) {
      try {
        // Find React fiber/props key
        const reactPropsKey = Object.keys(el).find(k =>
          k.startsWith('__reactProps') || k.startsWith('__reactEvents')
        );
        if (reactPropsKey && el[reactPropsKey]) {
          const props = el[reactPropsKey];
          if (props.onInput) props.onInput({ target: el, currentTarget: el });
          if (props.onChange) props.onChange({ target: el, currentTarget: el });
          if (props.onBeforeInput) props.onBeforeInput({ target: el, currentTarget: el, data: el.textContent });
        }

        // Also check parent for handlers
        const parent = el.closest('[class*="sc-74ba1bc0"]') || el.parentElement;
        if (parent) {
          const parentKey = Object.keys(parent).find(k => k.startsWith('__reactProps'));
          if (parentKey && parent[parentKey]) {
            const pp = parent[parentKey];
            if (pp.onInput) pp.onInput({ target: el, currentTarget: el });
            if (pp.onChange) pp.onChange({ target: el, currentTarget: el });
          }
        }
      } catch (e) {
        console.log('[FlowAutomator] React change trigger skipped:', e.message);
      }
    }

    /**
     * Click the Generate/Create button ("Tạo")
     */
    async function clickGenerate() {
      const btn = await waitForElement('generateButton');

      // Check if button is disabled
      if (btn.disabled) {
        console.log('[FlowAutomator] Generate button is disabled, waiting...');
        await delay(1000);
        if (btn.disabled) {
          return { success: false, data: null, error: 'Generate button is still disabled' };
        }
      }

      console.log('[FlowAutomator] Clicking Generate button');
      btn.click();
      // Also try dispatching pointer events for React
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      await delay(1000);
      return { success: true, data: null, error: null };
    }

    /**
     * Wait for video generation to complete
     */
    function waitForCompletion(timeoutMs = 180000) {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          observer.disconnect();
          resolve({ success: false, data: null, error: `Video generation timed out after ${timeoutMs / 1000}s` });
        }, timeoutMs);

        const checkResult = () => {
          // Check for error (filter out "Flow" false positive)
          const errorEl = findElement('errorMessage');
          if (errorEl) {
            const errText = errorEl.textContent.trim();
            if (errText && errText !== 'Flow' && errText.length > 5) {
              observer.disconnect();
              clearTimeout(timeout);
              return resolve({ success: false, data: null, error: `Google Flow error: ${errText}` });
            }
          }
          // Check for completed video
          const video = findElement('resultVideoElement');
          if (video && (video.src || video.querySelector('source'))) {
            observer.disconnect();
            clearTimeout(timeout);
            return resolve({ success: true, data: { videoFound: true }, error: null });
          }
        };

        // Wait before first check to let generation start
        setTimeout(checkResult, 5000);

        const observer = new MutationObserver(() => checkResult());
        observer.observe(document.body, {
          childList: true, subtree: true,
          attributes: true, attributeFilter: ['src'],
        });
      });
    }

    /**
     * Execute a full prompt cycle:
     * 1. Select mode → 2. Select model → 3. Select ratio → 4. Upload image
     * → 5. Fill prompt → 6. Generate → 7. Wait → 8. Extract frame
     */
    async function executeFullPromptCycle(promptText, firstFrameImage, options = {}) {
      const {
        aspectRatio = 'landscape',
        useLowerPriority = true,
        extractLastFrame: shouldExtractFrame = false,
      } = options;

      const steps = [
        { name: 'selectVideoMode', fn: () => selectVideoMode() },
        { name: 'selectModel', fn: () => selectModel(useLowerPriority) },
        { name: 'selectAspectRatio', fn: () => selectAspectRatio(aspectRatio === '9:16' ? 'portrait' : 'landscape') },
        { name: 'uploadImage', fn: () => uploadImage(firstFrameImage) },
        { name: 'fillPrompt', fn: () => fillPrompt(promptText) },
        { name: 'clickGenerate', fn: () => clickGenerate() },
        { name: 'waitCompletion', fn: () => waitForCompletion() },
      ];

      // Conditionally add frame extraction
      if (shouldExtractFrame) {
        steps.push({ name: 'extractFrame', fn: () => extractLastFrame('resultVideoElement') });
      }

      for (const step of steps) {
        try {
          console.log(`[FlowAutomator] Step: ${step.name}`);
          const result = await step.fn();
          if (!result.success) {
            return { success: false, data: null, error: `Step "${step.name}" failed: ${result.error}` };
          }
          if (step.name === 'extractFrame') {
            return { success: true, data: { frameDataUrl: result.imageDataUrl }, error: null };
          }
        } catch (err) {
          return { success: false, data: null, error: `Step "${step.name}" threw: ${err.message}` };
        }
      }
      return { success: true, data: { videoFound: true }, error: null };
    }

    function getPageState() {
      if (!window.location.href.includes('labs.google/')) return 'not-flow-page';
      if (findElement('loadingIndicator')) return 'generating';
      if (findElement('resultVideoElement')) return 'has-result';
      if (findElement('promptInput')) return 'ready';
      return 'ready';
    }

    function delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    window.__VEO3_FLOW_AUTOMATOR = {
      selectVideoMode, selectModel, selectAspectRatio,
      uploadImage, fillPrompt, clickGenerate,
      waitForCompletion, executeFullPromptCycle, getPageState, waitForElement,
    };

  })();

} // end guard
