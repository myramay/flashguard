// FlashGuard detection core.
// Pure functions only (no DOM), so it can be unit-tested in Node.
//
// Based on WCAG 2.3.1 "Three Flashes or Below Threshold" and the Harding-style
// general-flash / red-flash definitions, with simplifications listed in README.md.

export const CONFIG = {
  // Sampling
  sampleFps: 30,            // frames sampled per second of video
  analysisWidth: 160,       // frames are downscaled to this width before analysis
  gridCols: 16,             // screen is split into a grid; rows follow the aspect ratio

  // General flash: opposing changes in relative luminance
  general: {
    minChange: 0.1,         // luminance change must be >= this (0..1)
    maxDarker: 0.8,         // ...and the darker of the two states must be below this
  },

  // Red flash: opposing changes involving saturated red
  red: {
    minSaturation: 0.8,     // R / (R + G + B) >= this counts as saturated red
    scale: 320,             // red value = (R - G - B) * scale, negatives clamp to 0
    minChange: 20,          // red value change must be >= this
  },

  minArea: 0.25,            // a transition counts only if it covers >= 25% of the frame
  windowSeconds: 1,         // sliding window length
  maxFlashesPerWindow: 3,   // FAIL when MORE than this many flashes occur in one window
  mergeGapSeconds: 0.5,     // failing windows closer than this merge into one segment
  seekTimeoutMs: 4000,      // give up waiting on a single frame seek after this long
};

// sRGB (0..255) -> linear (0..1) lookup table
const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function makeTracker(n) {
  return {
    dir: new Int8Array(n),        // 0 unknown, +1 rising, -1 falling
    peak: new Float32Array(n),    // most extreme value since the last transition
    lo: new Float32Array(n),      // used before the first transition
    hi: new Float32Array(n),
    quiet: new Int32Array(n),     // frames since this cell last changed state
    started: false,
  };
}

// Advances every cell's extremum tracker by one frame.
// A cell "transitions" when its value moves >= threshold away from its last
// extreme in the opposite direction. Returns the screen fraction that rose/fell.
function stepTracker(tr, values, threshold, isValid, weights, staleFrames) {
  let up = 0;
  let down = 0;
  const n = values.length;
  if (!tr.started) {
    for (let c = 0; c < n; c++) { tr.lo[c] = tr.hi[c] = tr.peak[c] = values[c]; }
    tr.started = true;
    return { up, down };
  }
  for (let c = 0; c < n; c++) {
    const v = values[c];
    // After a long quiet stretch, forget the old direction: a new swing starts fresh.
    // (Otherwise black -> calm (pause) -> white reads as one rise and the first flash is missed.)
    if (tr.dir[c] !== 0 && tr.quiet[c] > staleFrames) {
      tr.dir[c] = 0; tr.lo[c] = tr.hi[c] = tr.peak[c];
    }
    const d = tr.dir[c];
    tr.quiet[c]++;
    if (d === 0) {
      if (v < tr.lo[c]) tr.lo[c] = v;
      if (v > tr.hi[c]) tr.hi[c] = v;
      if (v - tr.lo[c] >= threshold && isValid(tr.lo[c], v)) {
        tr.dir[c] = 1; tr.peak[c] = v; tr.quiet[c] = 0; up += weights[c];
      } else if (tr.hi[c] - v >= threshold && isValid(v, tr.hi[c])) {
        tr.dir[c] = -1; tr.peak[c] = v; tr.quiet[c] = 0; down += weights[c];
      }
    } else if (d === 1) {
      if (v > tr.peak[c]) tr.peak[c] = v;
      else if (tr.peak[c] - v >= threshold && isValid(v, tr.peak[c])) {
        tr.dir[c] = -1; tr.peak[c] = v; tr.quiet[c] = 0; down += weights[c];
      }
    } else {
      if (v < tr.peak[c]) tr.peak[c] = v;
      else if (v - tr.peak[c] >= threshold && isValid(tr.peak[c], v)) {
        tr.dir[c] = 1; tr.peak[c] = v; tr.quiet[c] = 0; up += weights[c];
      }
    }
  }
  return { up, down };
}

/**
 * Streaming analyzer. Call push() with RGBA pixel data for each sampled frame,
 * then finish() to get hazardous segments.
 */
export function createAnalyzer(width, height, cfg = CONFIG) {
  const cols = Math.max(1, Math.min(cfg.gridCols, width));
  const rows = Math.max(1, Math.min(height, Math.round((cols * height) / width)));
  const n = cols * rows;

  const cellOf = new Int32Array(width * height);
  const counts = new Float64Array(n);
  for (let y = 0; y < height; y++) {
    const cy = Math.min(rows - 1, Math.floor((y * rows) / height));
    for (let x = 0; x < width; x++) {
      const cx = Math.min(cols - 1, Math.floor((x * cols) / width));
      const c = cy * cols + cx;
      cellOf[y * width + x] = c;
      counts[c]++;
    }
  }
  const total = width * height;
  const weights = new Float64Array(n);
  for (let c = 0; c < n; c++) weights[c] = counts[c] / total;

  const sumR = new Float64Array(n);
  const sumG = new Float64Array(n);
  const sumB = new Float64Array(n);
  const lum = new Float32Array(n);
  const redv = new Float32Array(n);

  const lumTracker = makeTracker(n);
  const redTracker = makeTracker(n);
  const lumValid = (darker) => darker < cfg.general.maxDarker;
  const staleFrames = Math.round(cfg.windowSeconds * cfg.sampleFps);
  const redValid = () => true; // saturation is enforced when computing the red value

  const events = { general: [], red: [] };
  const lastDir = { general: 0, red: 0 };
  const lastEventT = { general: -Infinity, red: -Infinity };
  let lastT = 0;

  function record(kind, { up, down }, t) {
    const dir = up >= down ? 1 : -1;
    const area = Math.max(up, down);
    // Only count opposing transitions: a frame-level transition must reverse the previous one.
    // After a quiet gap longer than the window, any direction starts a new sequence
    // (otherwise e.g. calm -> white is dropped when the last counted change, long ago, was also "up").
    const gap = t - lastEventT[kind] > cfg.windowSeconds;
    if (area >= cfg.minArea && (dir !== lastDir[kind] || gap)) {
      events[kind].push({ t, dir, area });
      lastDir[kind] = dir;
      lastEventT[kind] = t;
    }
  }

  return {
    grid: { cols, rows },
    push(rgba, t) {
      sumR.fill(0); sumG.fill(0); sumB.fill(0);
      for (let p = 0, i = 0; p < total; p++, i += 4) {
        const c = cellOf[p];
        sumR[c] += LINEAR[rgba[i]];
        sumG[c] += LINEAR[rgba[i + 1]];
        sumB[c] += LINEAR[rgba[i + 2]];
      }
      for (let c = 0; c < n; c++) {
        const r = sumR[c] / counts[c];
        const g = sumG[c] / counts[c];
        const b = sumB[c] / counts[c];
        lum[c] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const s = r + g + b;
        const sat = s > 0 ? r / s : 0;
        redv[c] = sat >= cfg.red.minSaturation ? Math.max(0, (r - g - b) * cfg.red.scale) : 0;
      }
      record('general', stepTracker(lumTracker, lum, cfg.general.minChange, lumValid, weights, staleFrames), t);
      record('red', stepTracker(redTracker, redv, cfg.red.minChange, redValid, weights, staleFrames), t);
      lastT = t;
    },
    finish(duration = lastT) {
      return summarize(events, duration, cfg);
    },
  };
}

function failingWindows(evts, kind, cfg) {
  const maxTransitions = cfg.maxFlashesPerWindow * 2; // a flash = 2 opposing transitions
  const out = [];
  let j = 0;
  for (let i = 0; i < evts.length; i++) {
    if (j < i) j = i;
    while (j < evts.length && evts[j].t < evts[i].t + cfg.windowSeconds) j++;
    const count = j - i;
    if (count > maxTransitions) {
      out.push({ start: evts[i].t, end: evts[j - 1].t, count, kind });
    }
  }
  return out;
}

export function summarize(events, duration, cfg = CONFIG) {
  const windows = [
    ...failingWindows(events.general, 'general', cfg),
    ...failingWindows(events.red, 'red', cfg),
  ].sort((a, b) => a.start - b.start);

  const frame = 1 / cfg.sampleFps;
  const merged = [];
  for (const w of windows) {
    const cur = merged[merged.length - 1];
    if (cur && w.start <= cur.end + cfg.mergeGapSeconds) {
      cur.end = Math.max(cur.end, w.end);
      cur.kinds.add(w.kind);
      cur.peakTransitions = Math.max(cur.peakTransitions, w.count);
    } else {
      merged.push({ start: w.start, end: w.end, kinds: new Set([w.kind]), peakTransitions: w.count });
    }
  }

  const all = [...events.general, ...events.red];
  const segments = merged.map((s, i) => {
    const start = Math.max(0, s.start - frame / 2);
    const end = Math.min(duration, s.end + frame / 2);
    let area = 0;
    for (const e of all) if (e.t >= s.start && e.t <= s.end) area = Math.max(area, e.area);
    const kinds = [...s.kinds].sort().reverse(); // 'red' before 'general'
    return {
      id: i,
      start,
      end,
      kinds,
      type: kinds.includes('red') ? 'red' : 'general',
      flashesPerSecond: s.peakTransitions / 2 / cfg.windowSeconds,
      areaPercent: Math.round(area * 100),
    };
  });

  return {
    pass: segments.length === 0,
    segments,
    eventCounts: { general: events.general.length, red: events.red.length },
  };
}
