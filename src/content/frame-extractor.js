/**
 * FrameExtractor — Extract last frame from video element using Canvas API
 * Handles CORS restrictions with multiple fallback strategies
 */

// Guard against double injection
if (!window.__VEO3_FRAME_EXTRACTOR) {

(function() {
  'use strict';

  /**
   * Extract the last frame from a video element
   * Strategy: seek to end → draw on canvas → toDataURL
   * Fallback: VideoFrame API if canvas is tainted by CORS
   */
  async function extractLastFrame(videoSelectorKey = 'resultVideoElement') {
    const { findElement } = window.__VEO3_SELECTORS;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[FrameExtractor] ⏰ Frame extraction timed out (15s)');
        resolve({
          success: false, imageDataUrl: null, width: 0, height: 0,
          error: 'Frame extraction timed out (15s)',
        });
      }, 15000);

      try {
        const video = findElement(videoSelectorKey);
        if (!video) {
          clearTimeout(timeout);
          console.warn('[FrameExtractor] ❌ Video element not found');
          return resolve({
            success: false, imageDataUrl: null, width: 0, height: 0,
            error: 'Video element not found',
          });
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

        const doExtract = () => {
          // Seek to the last frame
          const targetTime = video.duration ? video.duration - 0.05 : video.currentTime;
          console.log(`[FrameExtractor] Seeking to ${targetTime.toFixed(2)}s (duration: ${video.duration?.toFixed(2)}s)`);
          video.currentTime = targetTime;

          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            clearTimeout(timeout);

            const w = video.videoWidth || video.clientWidth || 1280;
            const h = video.videoHeight || video.clientHeight || 720;
            console.log(`[FrameExtractor] Video dimensions: ${w}x${h}`);

            // Strategy 1: Canvas drawImage
            try {
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(video, 0, 0, w, h);

              // Test if canvas is tainted
              const imageDataUrl = canvas.toDataURL('image/png');
              console.log(`[FrameExtractor] ✅ Frame extracted via Canvas: ${w}x${h} (${(imageDataUrl.length / 1024).toFixed(0)}KB)`);
              resolve({ success: true, imageDataUrl, width: w, height: h, error: null });
              return;
            } catch (canvasErr) {
              console.warn(`[FrameExtractor] Canvas capture failed (likely CORS): ${canvasErr.message}`);
            }

            // Strategy 2: VideoFrame API (Chrome 94+)
            if (typeof VideoFrame !== 'undefined') {
              try {
                console.log('[FrameExtractor] Trying VideoFrame API fallback...');
                const frame = new VideoFrame(video);
                const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(frame, 0, 0);
                frame.close();
                canvas.convertToBlob({ type: 'image/png' }).then(blob => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    console.log(`[FrameExtractor] ✅ Frame extracted via VideoFrame API: ${frame.displayWidth}x${frame.displayHeight}`);
                    resolve({ success: true, imageDataUrl: reader.result, width: frame.displayWidth, height: frame.displayHeight, error: null });
                  };
                  reader.readAsDataURL(blob);
                }).catch(blobErr => {
                  console.warn(`[FrameExtractor] VideoFrame blob conversion failed: ${blobErr.message}`);
                  resolve({ success: false, imageDataUrl: null, width: 0, height: 0, error: `All frame extraction methods failed. Canvas: CORS tainted. VideoFrame: ${blobErr.message}` });
                });
                return;
              } catch (vfErr) {
                console.warn(`[FrameExtractor] VideoFrame API failed: ${vfErr.message}`);
              }
            }

            // All strategies failed
            resolve({
              success: false, imageDataUrl: null, width: 0, height: 0,
              error: 'Frame extraction failed: canvas is CORS-tainted and VideoFrame API unavailable',
            });
          };

          video.addEventListener('seeked', onSeeked);
          // Edge case: already at the target time
          if (Math.abs(video.currentTime - targetTime) < 0.2) {
            video.removeEventListener('seeked', onSeeked);
            onSeeked();
          }
        };

        if (video.readyState >= 2) {
          doExtract();
        } else {
          console.log('[FrameExtractor] Waiting for video to load...');
          video.addEventListener('loadeddata', doExtract, { once: true });
          if (video.readyState === 0) video.load();
        }
      } catch (err) {
        clearTimeout(timeout);
        console.error('[FrameExtractor] Unexpected error:', err);
        resolve({ success: false, imageDataUrl: null, width: 0, height: 0, error: `Frame extraction error: ${err.message}` });
      }
    });
  }

  window.__VEO3_FRAME_EXTRACTOR = { extractLastFrame };

})();

} // end guard
