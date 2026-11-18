// Samples frames from a video (hidden <video> + canvas) and runs the detector.
import { CONFIG, createAnalyzer } from './detect.js';
import { loadVideo, seekTo, disposeVideo } from './video.js';

export async function analyzeVideo(url, { onProgress, signal, cfg = CONFIG } = {}) {
  const v = await loadVideo(url);
  try {
    const duration = v.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('We could not tell how long this video is.');
    }
    const w = Math.min(cfg.analysisWidth, v.videoWidth || cfg.analysisWidth);
    const h = Math.max(1, Math.round((w * (v.videoHeight || 9)) / (v.videoWidth || 16)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const analyzer = createAnalyzer(w, h, cfg);

    const n = Math.max(1, Math.floor(duration * cfg.sampleFps));
    let lastReport = 0;
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      // Sample the middle of each frame interval to avoid landing on frame boundaries.
      const t = Math.min((i + 0.5) / cfg.sampleFps, duration - 0.001);
      await seekTo(v, t);
      ctx.drawImage(v, 0, 0, w, h);
      analyzer.push(ctx.getImageData(0, 0, w, h).data, t);
      const now = performance.now();
      if (onProgress && now - lastReport > 100) {
        lastReport = now;
        onProgress(i / n);
      }
    }
    onProgress?.(1);
    return {
      ...analyzer.finish(duration),
      duration,
      width: v.videoWidth,
      height: v.videoHeight,
    };
  } finally {
    disposeVideo(v);
  }
}
