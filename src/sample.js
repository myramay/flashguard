// Generates synthetic test videos in the browser. The canvas is kept off-screen,
// so the flashing is never shown to the person using FlashGuard.
import { offscreen, pickMimeType } from './video.js';

export const SAMPLE_TIMELINE = [
  { d: 5, label: 'Part 1: calm scene' },
  { d: 2, hz: 6, color: '#ff0000', label: 'Part 2: red flashing, 6 per second' },
  { d: 3, label: 'Part 3: calm scene' },
  { d: 2, hz: 2, color: '#ffffff', label: 'Part 4: white flashing, 2 per second' },
];

function drawFrame(ctx, t, timeline, W, H) {
  let acc = 0;
  let part = timeline[0];
  for (part of timeline) {
    if (t < acc + part.d) break;
    acc += part.d;
  }
  const local = t - acc;
  const k = H / 360; // scale text with resolution
  if (part.hz) {
    const on = Math.floor(local * part.hz * 2) % 2 === 0;
    ctx.fillStyle = on ? part.color : '#000000';
    ctx.fillRect(0, 0, W, H);
  } else {
    // Calm, slowly drifting gradient
    const shift = Math.sin(t * 0.6) * 40;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, `hsl(${195 + shift}, 45%, 38%)`);
    g.addColorStop(1, `hsl(${160 + shift}, 40%, 30%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `600 ${30 * k}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('Sample science lesson', W / 2, H / 2 - 10 * k);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, H - 40 * k, W, 40 * k);
  ctx.fillStyle = '#ffffff';
  ctx.font = `500 ${18 * k}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(`${part.label}  ·  ${t.toFixed(1)}s`, 14 * k, H - 14 * k);
}

/**
 * Records a synthetic video in real time (takes as long as the timeline).
 * @param {{timeline?:Array, width?:number, height?:number, withAudio?:boolean,
 *          keyframeInterval?:number|null, name?:string, onProgress?:Function}} opts
 */
export async function makeSyntheticVideo({
  timeline = SAMPLE_TIMELINE,
  width = 640,
  height = 360,
  withAudio = false,
  keyframeInterval = 500,
  name = 'flashguard-sample',
  onProgress,
} = {}) {
  const mimeType = pickMimeType();
  if (mimeType === null) throw new Error('This browser cannot record video, so the sample cannot be made.');
  const total = timeline.reduce((s, p) => s + p.d, 0);

  const canvas = offscreen(document.createElement('canvas'));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  drawFrame(ctx, 0, timeline, width, height);

  const stream = canvas.captureStream(30);
  let ac;
  if (withAudio) {
    // A quiet steady tone so tests can confirm audio survives export.
    ac = new AudioContext();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    gain.gain.value = 0.1;
    osc.frequency.value = 440;
    const dest = ac.createMediaStreamDestination();
    osc.connect(gain).connect(dest);
    osc.start();
    await ac.resume();
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  }
  const options = { videoBitsPerSecond: 2_500_000 };
  if (keyframeInterval) options.videoKeyFrameIntervalDuration = keyframeInterval;
  if (mimeType) options.mimeType = mimeType;
  const rec = new MediaRecorder(stream, options);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));

  rec.start(250);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= total) return resolve();
      drawFrame(ctx, t, timeline, width, height);
      onProgress?.(t / total);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());
  ac?.close();
  canvas.remove();
  const type = rec.mimeType || mimeType || 'video/webm';
  return new File(chunks, `${name}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });
}

export function makeSampleVideo({ onProgress } = {}) {
  return makeSyntheticVideo({ onProgress });
}
