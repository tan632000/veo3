/**
 * FrameExtractor — Extract last frame from video element using Canvas API
 * Handles CORS restrictions with multiple fallback strategies
 * Includes quality validation: retries if captured frame is suspiciously small (blank)
 */

// Guard against double injection
if (!window.__VEO3_FRAME_EXTRACTOR) {

(function() {
  'use strict';

  /** Minimum acceptable frame size in bytes — below this is likely blank/not decoded */
  const MIN_FRAME_SIZE_KB = 100;
  /** Max retries for quality check */
  const MAX_CAPTURE_RETRIES = 5;
  /** Delay between retries in ms */
  const RETRY_DELAY_MS = 1000;

  /**
   * Extract the last frame from a video element
   * Strategy: seek to end → draw on canvas → validate size → toDataURL
   * Retries with increasing delay if frame appears blank (< MIN_FRAME_SIZE_KB)
   */
  async function extractLastFrame(videoElementOrKey = 'resultVideoElement') {
    const { findElement } = window.__VEO3_SELECTORS;

    // Accept either a DOM element directly or a selector key string
    const video = (videoElementOrKey instanceof HTMLElement)
      ? videoElementOrKey
      : findElement(videoElementOrKey);

    if (!video) {
      console.warn('[FrameExtractor] ❌ Video element not found');
      return {
        success: false, imageDataUrl: null, width: 0, height: 0,
        error: 'Video element not found',
      };
    }

    console.log(`[FrameExtractor] Found video: src=${video.src?.substring(0, 60)}, readyState=${video.readyState}, duration=${video.duration}`);

    // Try to set crossOrigin to allow canvas capture
    try {
      if (!video.crossOrigin) {
        video.crossOrigin = 'anonymous';
      }
    } catch (e) {
      console.log('[FrameExtractor] Could not set crossOrigin:', e.message);
    }

    // Step 1: Ensure video is loaded enough to seek
    await waitForVideoReady(video);

    // Step 2: Seek to the last frame
    const targetTime = video.duration ? video.duration - 0.05 : video.currentTime;
    console.log(`[FrameExtractor] Seeking to ${targetTime.toFixed(2)}s (duration: ${video.duration?.toFixed(2)}s)`);
    await seekTo(video, targetTime);

    // Step 3: Capture frame with quality validation + retries
    const w = video.videoWidth || video.clientWidth || 1280;
    const h = video.videoHeight || video.clientHeight || 720;
    console.log(`[FrameExtractor] Video dimensions: ${w}x${h}`);

    for (let attempt = 1; attempt <= MAX_CAPTURE_RETRIES; attempt++) {
      const result = captureFrame(video, w, h);
      if (result.success) {
        const sizeKB = result.imageDataUrl.length / 1024;
        if (sizeKB >= MIN_FRAME_SIZE_KB) {
          console.log(`[FrameExtractor] ✅ Frame extracted (attempt ${attempt}): ${w}x${h} (${sizeKB.toFixed(0)}KB)`);
          return result;
        }
        // Frame too small — likely blank/not decoded yet
        console.warn(`[FrameExtractor] ⚠️ Frame too small (${sizeKB.toFixed(0)}KB < ${MIN_FRAME_SIZE_KB}KB) on attempt ${attempt}/${MAX_CAPTURE_RETRIES}, retrying...`);
      } else {
        console.warn(`[FrameExtractor] ⚠️ Capture failed on attempt ${attempt}: ${result.error}`);
      }

      if (attempt < MAX_CAPTURE_RETRIES) {
        // Wait and re-seek to force decoder to re-render
        const delay = RETRY_DELAY_MS * attempt;
        console.log(`[FrameExtractor] Waiting ${delay}ms before retry...`);
        await sleep(delay);

        // Re-seek slightly (nudge up then back) to force a fresh decode
        const nudge = attempt * 0.1;
        await seekTo(video, Math.max(0, targetTime - nudge));
        await sleep(300);
        await seekTo(video, targetTime);
        await sleep(300);
      }
    }

    // All retries exhausted — return whatever we got (even small)
    console.warn(`[FrameExtractor] ⚠️ All ${MAX_CAPTURE_RETRIES} retries exhausted, returning best effort frame`);
    const finalResult = captureFrame(video, w, h);
    if (finalResult.success) {
      console.log(`[FrameExtractor] Final frame: ${w}x${h} (${(finalResult.imageDataUrl.length / 1024).toFixed(0)}KB)`);
      return finalResult;
    }

    // Try VideoFrame API as last resort
    return await captureViaVideoFrameAPI(video);
  }

  /**
   * Wait for video to reach at least readyState 2 (HAVE_CURRENT_DATA)
   * Prefers canplaythrough (readyState 4) if it arrives within timeout
   */
  function waitForVideoReady(video, timeoutMs = 10000) {
    return new Promise((resolve) => {
      if (video.readyState >= 3) {
        return resolve();
      }

      console.log(`[FrameExtractor] Waiting for video to be ready (readyState=${video.readyState})...`);

      const cleanup = () => {
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('canplaythrough', onReady);
        video.removeEventListener('loadeddata', onFallback);
        clearTimeout(fallbackTimeout);
        clearTimeout(hardTimeout);
      };

      const onReady = () => {
        cleanup();
        console.log(`[FrameExtractor] Video ready (readyState=${video.readyState})`);
        resolve();
      };

      const onFallback = () => {
        if (video.readyState >= 2) {
          cleanup();
          console.log(`[FrameExtractor] Video partially ready via loadeddata (readyState=${video.readyState})`);
          resolve();
        }
      };

      // Best case: canplay/canplaythrough
      video.addEventListener('canplay', onReady, { once: true });
      video.addEventListener('canplaythrough', onReady, { once: true });
      // Fallback: loadeddata after 5s
      video.addEventListener('loadeddata', onFallback, { once: true });

      const fallbackTimeout = setTimeout(() => {
        if (video.readyState >= 2) {
          cleanup();
          console.log(`[FrameExtractor] Fallback timeout, readyState=${video.readyState}`);
          resolve();
        }
      }, 5000);

      const hardTimeout = setTimeout(() => {
        cleanup();
        console.warn(`[FrameExtractor] Hard timeout waiting for video readiness (readyState=${video.readyState})`);
        resolve(); // Continue anyway — retry logic will handle bad frames
      }, timeoutMs);

      if (video.readyState === 0) video.load();
    });
  }

  /**
   * Seek to a specific time and wait for seeked event
   */
  function seekTo(video, time) {
    return new Promise((resolve) => {
      if (Math.abs(video.currentTime - time) < 0.05) {
        // Already at target — wait a bit for decoder
        setTimeout(resolve, 200);
        return;
      }

      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        // Additional delay to let decoder fully render the frame
        setTimeout(resolve, 300);
      };

      video.addEventListener('seeked', onSeeked);
      video.currentTime = time;

      // Safety timeout in case seeked never fires
      setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      }, 5000);
    });
  }

  /**
   * Capture current video frame to canvas and return as data URL
   */
  function captureFrame(video, w, h) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);

      // Test if canvas is tainted by CORS
      const imageDataUrl = canvas.toDataURL('image/png');
      return { success: true, imageDataUrl, width: w, height: h, error: null };
    } catch (err) {
      return {
        success: false, imageDataUrl: null, width: 0, height: 0,
        error: `Canvas capture failed: ${err.message}`,
      };
    }
  }

  /**
   * Fallback: VideoFrame API (Chrome 94+)
   */
  async function captureViaVideoFrameAPI(video) {
    if (typeof VideoFrame === 'undefined') {
      return {
        success: false, imageDataUrl: null, width: 0, height: 0,
        error: 'Frame extraction failed: canvas is CORS-tainted and VideoFrame API unavailable',
      };
    }

    try {
      console.log('[FrameExtractor] Trying VideoFrame API fallback...');
      const frame = new VideoFrame(video);
      const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(frame, 0, 0);
      frame.close();

      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const imageDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      console.log(`[FrameExtractor] ✅ Frame extracted via VideoFrame API: ${canvas.width}x${canvas.height}`);
      return { success: true, imageDataUrl, width: canvas.width, height: canvas.height, error: null };
    } catch (err) {
      console.warn(`[FrameExtractor] VideoFrame API failed: ${err.message}`);
      return {
        success: false, imageDataUrl: null, width: 0, height: 0,
        error: `All frame extraction methods failed: ${err.message}`,
      };
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  window.__VEO3_FRAME_EXTRACTOR = { extractLastFrame };

})();

} // end guard
