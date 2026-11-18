// End-to-end test helpers, loaded into the running app page by the browser driver:
//   await import('/tests/e2e/harness.js')
// Long-running steps store results on window.__e2e so the driver can poll them.
import { makeSyntheticVideo } from '/src/sample.js';
import { offscreen } from '/src/video.js';

const e2e = (window.__e2e = window.__e2e || { log: [] });
const log = (m) => e2e.log.push(`${(performance.now() / 1000).toFixed(1)}s ${m}`);

export const LONG_TIMELINE = [
  { d: 8, label: 'calm' },
  { d: 3, hz: 8, color: '#ff0000', label: 'red 8Hz' },   // should fail (8–11s)
  { d: 6, label: 'calm' },
  { d: 2, hz: 5, color: '#ffffff', label: 'white 5Hz' }, // should fail (17–19s)
  { d: 5, label: 'calm' },
  { d: 2, hz: 2, color: '#ffffff', label: 'white 2Hz' }, // should pass (24–26s)
  { d: 4, label: 'calm' },
];

// Put a File into the app's real file input, exactly like a user choosing it.
export function feedFile(file) {
  const input = document.querySelector('#file-input');
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function generateLong() {
  e2e.long = { status: 'generating' };
  const t0 = performance.now();
  const file = await makeSyntheticVideo({
    timeline: LONG_TIMELINE,
    width: 1280,
    height: 720,
    withAudio: true,
    keyframeInterval: null, // browser default: sparse keyframes, the worst case for seeking
    name: 'long-test-30s',
  });
  e2e.long = { status: 'ready', file, genSeconds: (performance.now() - t0) / 1000, size: file.size };
  log(`generated ${file.name} ${(file.size / 1e6).toFixed(1)}MB`);
}

/**
 * Plays an exported video (muted) and measures every decoded frame.
 * Checks: playable, finite duration, frozen + captioned inside segments, moving outside, audio decoded.
 */
export async function inspectExport(url, segments) {
  e2e.inspect = { status: 'running' };
  const v = offscreen(document.createElement('video'));
  v.muted = true;
  v.playsInline = true;
  v.src = url;
  await new Promise((res, rej) => {
    v.addEventListener('loadeddata', res, { once: true });
    v.addEventListener('error', () => rej(new Error(`not playable: ${v.error?.message}`)), { once: true });
  });
  const tw = 160, th = 90;
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const big = document.createElement('canvas');
  const frames = [];
  let snapshot = null;
  const snapAt = segments.length ? (segments[0].start + segments[0].end) / 2 : 1;

  await v.play();
  await new Promise((resolve) => {
    let last = -1;
    v.addEventListener('ended', resolve, { once: true });
    const tick = () => {
      if (v.currentTime !== last) {
        last = v.currentTime;
        ctx.drawImage(v, 0, 0, tw, th);
        const d = ctx.getImageData(0, 0, tw, th).data;
        const gray = new Uint8Array(tw * th);
        let redish = 0;
        for (let i = 0, p = 0; p < gray.length; p++, i += 4) {
          gray[p] = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) | 0;
          if (d[i] > 150 && d[i + 1] < 60 && d[i + 2] < 60) redish++;
        }
        let sum = 0;
        for (let p = 0; p < gray.length; p++) sum += gray[p];
        frames.push({ t: v.currentTime, gray, mean: sum / gray.length, redFrac: redish / gray.length });
        if (!snapshot && v.currentTime >= snapAt) {
          big.width = v.videoWidth; big.height = v.videoHeight;
          big.getContext('2d').drawImage(v, 0, 0);
          snapshot = big.toDataURL('image/png');
        }
      }
      if (!v.ended) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const rows = (g, y0, y1) => {
    const out = [];
    for (let y = Math.floor(y0 * th); y < Math.floor(y1 * th); y++)
      for (let x = 0; x < tw; x++) out.push(g[y * tw + x]);
    return out;
  };
  const meanAbsDiff = (a, b) => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0) / a.length;

  const inSeg = (t) => segments.find((s) => t >= s.start + 0.15 && t < s.end - 0.15);
  const report = { duration: v.duration, width: v.videoWidth, height: v.videoHeight, frames: frames.length, segments: [] };
  for (const s of segments) {
    const fs = frames.filter((f) => inSeg(f.t) === s);
    let maxPictureDiff = 0;
    for (let i = 1; i < fs.length; i++) {
      // picture area between the top tag and the caption box
      maxPictureDiff = Math.max(maxPictureDiff, meanAbsDiff(rows(fs[i].gray, 0.2, 0.6), rows(fs[i - 1].gray, 0.2, 0.6)));
    }
    const cap = fs.map((f) => {
      const r = rows(f.gray, 0.72, 0.93);
      return { white: r.filter((x) => x > 170).length / r.length, dark: r.filter((x) => x < 40).length / r.length };
    });
    // Raw flash states (mostly red, near-white or near-black) just around the part = leaked frames.
    const edge = frames.filter((f) => f.t >= s.start - 0.1 && f.t < s.end + 0.1);
    const leakFrames = edge.filter((f) => f.redFrac > 0.3 || f.mean > 200 || f.mean < 10).map((f) => +f.t.toFixed(2));
    report.segments.push({
      start: s.start, end: s.end, framesInside: fs.length, leakFrames,
      maxPictureDiff: +maxPictureDiff.toFixed(2),
      maxRedFrac: +Math.max(0, ...fs.map((f) => f.redFrac)).toFixed(3),
      minCaptionWhite: +Math.min(...cap.map((x) => x.white)).toFixed(3),
      minCaptionDark: +Math.min(...cap.map((x) => x.dark)).toFixed(3),
    });
  }
  // Motion outside segments: the calm gradient drifts and the timestamp text changes.
  const outside = frames.filter((f) => !segments.some((s) => f.t >= s.start - 0.2 && f.t < s.end + 0.2));
  report.outsideFrames = outside.length;
  report.outsideChanges = outside.length > 1 && meanAbsDiff(outside[0].gray, outside[outside.length - 1].gray) > 0.5;
  report.audioBytes = v.webkitAudioDecodedByteCount ?? null;
  // Compact trace for debugging boundaries: [time, mean luminance, red fraction]
  e2e.trace = frames.map((f) => [+f.t.toFixed(3), Math.round(f.gray.reduce((a, b) => a + b, 0) / f.gray.length), +f.redFrac.toFixed(2)]);
  v.remove();
  e2e.inspect = { status: 'done', report, snapshot };
  log('inspect done');
}

e2e.ready = true;
