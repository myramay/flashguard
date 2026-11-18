// Renders a safer copy of the video through canvas + MediaRecorder.
// The render canvas is off-screen; the user never sees the original flashing.
import { loadVideo, seekTo, disposeVideo, offscreen, pickMimeType, formatRange } from './video.js';

export const MITIGATION = {
  maxWidth: 1280,
  freezeDim: 0.4,          // black overlay opacity: frame shown at 60% brightness
  smoothTau: 0.35,         // seconds; time constant of the running average
  smoothDesaturate: 0.7,   // 0..1, how much colour to remove inside flashing parts
  smoothContrast: 0.5,     // 0..1, mid-grey blend amount (reduces contrast)
  padSeconds: 0.25,        // mitigate a little before/after each part: covers detection
                           // granularity and decoded frames lagging video.currentTime
};

function wrap(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] += '…';
  }
  return lines;
}

function drawCaption(ctx, text, W, H) {
  // Small tag at the top so viewers know why the picture changed
  const tagSize = Math.max(14, Math.round(H / 30));
  ctx.font = `600 ${tagSize}px system-ui, -apple-system, sans-serif`;
  const tag = 'Flashing hidden for safety';
  const tw = ctx.measureText(tag).width;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(W * 0.03, H * 0.04, tw + tagSize * 1.2, tagSize * 1.9);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(tag, W * 0.03 + tagSize * 0.6, H * 0.04 + tagSize * 0.95);

  // Large, high-contrast description caption
  const fs = Math.max(20, Math.round(H / 15));
  ctx.font = `600 ${fs}px system-ui, -apple-system, sans-serif`;
  const lines = wrap(ctx, text, W * 0.84, 4);
  const lineH = fs * 1.3;
  const pad = fs * 0.55;
  const boxH = lines.length * lineH + pad * 2;
  const y0 = H - boxH - H * 0.05;
  ctx.fillStyle = 'rgba(0,0,0,0.88)';
  ctx.fillRect(W * 0.05, y0, W * 0.9, boxH);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + pad + i * lineH + fs * 0.12));
}

/**
 * @param {string} url  object URL of the source video
 * @param {Array} segments  from detect.summarize
 * @param {{mode:'freeze'|'smooth', descriptions:string[], onProgress?:Function, signal?:AbortSignal}} opts
 */
export async function exportSafeVideo(url, segments, { mode, descriptions, onProgress, signal }) {
  const mimeType = pickMimeType();
  if (mimeType === null) throw new Error('This browser cannot record video, so it cannot export.');

  const v = await loadVideo(url, { muted: false });
  const duration = v.duration;
  const scale = Math.min(1, MITIGATION.maxWidth / v.videoWidth);
  const W = Math.round((v.videoWidth * scale) / 2) * 2;
  const H = Math.round((v.videoHeight * scale) / 2) * 2;

  const canvas = offscreen(document.createElement('canvas'));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Freeze frames. The first frame *inside* a flashing part is itself a flash state
  // (e.g. full-screen red), so we hold the last calm frame just before the part.
  // If the part starts at 0:00, use the frame just after it instead.
  const freezes = [];
  if (mode === 'freeze') {
    for (const s of segments) {
      const pad = MITIGATION.padSeconds + 0.1;
      const at = s.start >= pad ? s.start - pad : Math.min(s.end + pad, duration - 0.001);
      await seekTo(v, Math.max(0, at));
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      c.getContext('2d').drawImage(v, 0, 0, W, H);
      freezes.push(c);
    }
  }
  await seekTo(v, 0);

  // Running-average buffer for "reduce flashing" mode
  const avg = document.createElement('canvas');
  avg.width = W;
  avg.height = H;
  const actx = avg.getContext('2d');
  let avgReady = false;
  let lastNow = 0;

  const captionFor = (i) =>
    descriptions[i]?.trim() || `Flashing scene (${formatRange(segments[i])}) has been hidden.`;

  function draw(t) {
    const pad = MITIGATION.padSeconds;
    const i = segments.findIndex((s) => t >= s.start - pad && t < s.end + pad);
    if (i < 0) {
      ctx.drawImage(v, 0, 0, W, H);
      avgReady = false;
      return;
    }
    if (mode === 'freeze') {
      ctx.drawImage(freezes[i], 0, 0, W, H);
      ctx.fillStyle = `rgba(0,0,0,${MITIGATION.freezeDim})`;
      ctx.fillRect(0, 0, W, H);
    } else {
      const now = performance.now();
      if (!avgReady) {
        actx.globalAlpha = 1;
        actx.drawImage(v, 0, 0, W, H);
        avgReady = true;
      } else {
        const dt = Math.max(0, (now - lastNow) / 1000);
        actx.globalAlpha = 1 - Math.exp(-dt / MITIGATION.smoothTau);
        actx.drawImage(v, 0, 0, W, H);
      }
      lastNow = now;
      ctx.globalAlpha = 1;
      ctx.drawImage(avg, 0, 0, W, H);
      // Remove most colour (kills saturated red) ...
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = MITIGATION.smoothDesaturate;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, W, H);
      // ... and pull everything toward mid-grey (reduces contrast)
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = MITIGATION.smoothContrast;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    drawCaption(ctx, captionFor(i), W, H);
  }

  draw(0);
  const stream = canvas.captureStream(30);

  // Audio: route the element's sound into the recording only (not the speakers).
  let audioNote = '';
  let ac;
  try {
    ac = new AudioContext();
    const src = ac.createMediaElementSource(v);
    const dest = ac.createMediaStreamDestination();
    src.connect(dest);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    await ac.resume();
  } catch {
    audioNote = 'The original sound could not be included in this browser.';
  }

  const options = { videoBitsPerSecond: 5_000_000, videoKeyFrameIntervalDuration: 1000 };
  if (mimeType) options.mimeType = mimeType;
  const rec = new MediaRecorder(stream, options);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));

  try {
    await v.play();
  } catch {
    // Autoplay rules may block sound. Fall back to a silent render.
    v.muted = true;
    audioNote = 'The browser blocked sound during export, so this copy is silent.';
    await v.play();
  }
  // Start recording only once playback is running, so the output is not shifted
  // later than the source by the player's start-up delay.
  draw(v.currentTime);
  rec.start(500);

  let aborted = false;
  await new Promise((resolve) => {
    v.addEventListener('ended', resolve, { once: true });
    const tick = () => {
      if (signal?.aborted) {
        aborted = true;
        v.pause();
        return resolve();
      }
      draw(v.currentTime);
      onProgress?.(Math.min(1, v.currentTime / duration));
      if (v.ended) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  draw(Math.min(v.currentTime, duration - 0.001));
  rec.stop();
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());
  ac?.close();
  disposeVideo(v);
  canvas.remove();
  if (aborted) throw new DOMException('Cancelled', 'AbortError');

  const type = rec.mimeType || mimeType || 'video/webm';
  return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm', audioNote };
}
