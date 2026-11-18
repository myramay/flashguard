// Small helpers for working with <video> elements that are never shown on screen.
import { CONFIG } from './detect.js';

// An off-screen holder. Some browsers only capture canvases / decode video that
// are attached to the document. It sits outside the viewport so nothing is ever visible.
let holder;
export function offscreen(el) {
  if (!holder) {
    holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText =
      'position:fixed;left:-20000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
    document.body.appendChild(holder);
  }
  holder.appendChild(el);
  return el;
}

export function loadVideo(url, { muted = true } = {}) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = muted;
    v.playsInline = true;
    v.preload = 'auto';
    v.addEventListener('loadeddata', () => resolve(v), { once: true });
    v.addEventListener(
      'error',
      () => reject(new Error('This browser could not open that video. Try an MP4 (H.264) or WebM file.')),
      { once: true },
    );
    v.src = url;
    offscreen(v);
  }).then(fixDuration);
}

// WebM files from MediaRecorder often report duration = Infinity until the
// browser has scanned to the end. Seeking far ahead forces it to work it out.
export async function fixDuration(v) {
  if (Number.isFinite(v.duration) && v.duration > 0) return v;
  await new Promise((resolve) => {
    const done = () => {
      if (Number.isFinite(v.duration)) {
        v.removeEventListener('durationchange', done);
        v.removeEventListener('timeupdate', done);
        resolve();
      }
    };
    v.addEventListener('durationchange', done);
    v.addEventListener('timeupdate', done);
    setTimeout(resolve, 5000);
    v.currentTime = 1e101;
  });
  await seekTo(v, 0);
  return v;
}

export function seekTo(v, t, timeout = CONFIG.seekTimeoutMs) {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2 && !v.seeking) return resolve();
    let timer;
    const done = () => {
      clearTimeout(timer);
      v.removeEventListener('seeked', done);
      resolve();
    };
    timer = setTimeout(done, timeout);
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

export function disposeVideo(v) {
  v.pause();
  v.removeAttribute('src');
  v.load();
  v.remove();
}

export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const options = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

export function formatTime(sec, { precise = false } = {}) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  if (precise) return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
  return `${m}:${String(Math.floor(rest)).padStart(2, '0')}`;
}

// Whole-second range that always covers the segment (start rounded down, end rounded up)
export function formatRange(seg) {
  const a = formatTime(Math.floor(seg.start));
  // Small tolerance so half-frame padding (e.g. 7.03s) does not round up a whole second.
  const b = formatTime(Math.max(Math.ceil(seg.end - 0.1), Math.floor(seg.start) + 1));
  return `${a}–${b}`;
}
