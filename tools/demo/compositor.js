// Renders the FlashGuard demo video: scenes + narration + burned-in captions, recorded in real time.
// Nothing in this video flashes: the original hazard clip only appears as a single still frame.
import '@fontsource-variable/inter';
import script from './script.json';

const W = 1920, H = 1080;
const FONT = '"Inter Variable", Inter, system-ui, sans-serif';
const C = { bg: '#fafafa', fg: '#0a0a0a', muted: '#5c5c5c', border: '#e5e5e5', capBg: 'rgba(10,10,10,0.88)', capFg: '#ffffff' };
const LINE_GAP = 0.35, SCENE_GAP = 0.7, LEAD_IN = 0.6, TAIL = 0.6;
const BOX = { x: 80, y: 112, w: W - 160, h: 735 }; // content area above the caption band

const canvas = document.getElementById('c');
const main = canvas.getContext('2d');
const setStatus = (m) => (document.getElementById('status').textContent = m);
// Plain absolute path (dev-server tool). Vite rewrites `new URL('./assets/...', import.meta.url)`
// forms, which broke lookups in assets/voice/.
const ASSET_BASE = '/tools/demo/assets/';
const asset = (p) => ASSET_BASE + p;

const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image ' + src)); i.src = asset(src); });
const loadVideo = (src) => new Promise((res, rej) => {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = asset(src);
  v.addEventListener('loadeddata', () => res(v), { once: true });
  v.addEventListener('error', () => rej(new Error('video ' + src)), { once: true });
});
const seek = (v, t) => new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = t; });

function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function wrap(g, text, maxW) {
  const lines = []; let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function drawGlow(g, alpha) {
  g.save(); g.globalAlpha = alpha; g.filter = 'blur(60px)';
  for (const [x, y, col] of [[0.25, 0.35, 'hsl(227 81% 67%)'], [0.55, 0.28, 'hsl(125 51% 53%)'], [0.8, 0.4, 'hsl(318 58% 66%)']]) {
    const gr = g.createRadialGradient(W * x, H * y, 0, W * x, H * y, 520);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  g.restore();
}
function drawBrand(g, label) {
  g.fillStyle = C.fg; rr(g, 64, 36, 48, 48, 12); g.fill();
  g.fillStyle = '#fff'; g.beginPath();
  g.moveTo(88, 46); g.lineTo(102, 52); g.lineTo(102, 62); g.quadraticCurveTo(102, 72, 88, 76);
  g.quadraticCurveTo(74, 72, 74, 62); g.lineTo(74, 52); g.closePath(); g.fill();
  g.fillStyle = C.fg; g.font = `600 32px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText('FlashGuard', 128, 61);
  if (label) {
    g.font = `500 26px ${FONT}`;
    const w = g.measureText(label).width + 44;
    g.fillStyle = '#fff'; g.strokeStyle = C.border; g.lineWidth = 2;
    rr(g, W - 64 - w, 36, w, 50, 25); g.fill(); g.stroke();
    g.fillStyle = C.fg; g.textAlign = 'center'; g.fillText(label, W - 64 - w / 2, 62);
  }
}

// Everything that doesn't change during a scene is drawn once, offscreen.
function renderStatic(scene, assets) {
  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const g = off.getContext('2d');
  const v = scene.visual;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  if (v.type === 'title') {
    drawGlow(g, 0.22);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = C.fg; g.font = `600 150px ${FONT}`; g.fillText(v.title, W / 2, 390);
    g.fillStyle = C.muted; g.font = `500 54px ${FONT}`; g.fillText(v.subtitle, W / 2, 520);
    if (v.small) { g.font = `500 32px ${FONT}`; g.fillText(v.small, W / 2, 610); }
  } else if (v.type === 'text') {
    drawGlow(g, 0.12); drawBrand(g);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = C.muted; g.font = `600 30px ${FONT}`; g.fillText(v.kicker.toUpperCase(), 160, 260);
    g.fillStyle = C.fg; g.font = `600 76px ${FONT}`; g.fillText(v.title, 160, 360);
    g.font = `400 44px ${FONT}`;
    v.bullets.forEach((b, i) => {
      const y = 470 + i * 90;
      g.beginPath(); g.arc(176, y - 15, 8, 0, Math.PI * 2); g.fill();
      g.fillText(b, 210, y);
    });
  } else if (v.type === 'shot') {
    drawBrand(g, v.label);
    const img = assets.images[v.src];
    const s = Math.min(BOX.w / img.width, BOX.h / img.height);
    const w = img.width * s, h = img.height * s, x = BOX.x + (BOX.w - w) / 2, y = BOX.y + (BOX.h - h) / 2;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.12)'; g.shadowBlur = 40; g.shadowOffsetY = 12;
    g.fillStyle = '#fff'; rr(g, x, y, w, h, 18); g.fill(); g.restore();
    g.save(); rr(g, x, y, w, h, 18); g.clip(); g.drawImage(img, x, y, w, h); g.restore();
    g.strokeStyle = C.border; g.lineWidth = 2; rr(g, x, y, w, h, 18); g.stroke();
  } else if (v.type === 'compare') {
    drawBrand(g, 'Before and after');
    const pw = 840, ph = 472, gap = 80, x1 = (W - pw * 2 - gap) / 2, x2 = x1 + pw + gap, y = 290;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = C.fg; g.font = `600 40px ${FONT}`;
    g.fillText('Original', x1, y - 64); g.fillText('FlashGuard safe version', x2, y - 64);
    g.fillStyle = C.muted; g.font = `400 30px ${FONT}`;
    g.fillText('Still frame. The flashing is not shown.', x1, y - 22); g.fillText('Playing', x2, y - 22);
    g.save(); rr(g, x1, y, pw, ph, 16); g.clip(); g.drawImage(assets.still, x1, y, pw, ph); g.restore();
    g.strokeStyle = C.border; g.lineWidth = 2; rr(g, x1, y, pw, ph, 16); g.stroke();
    scene.videoRect = { x: x2, y, w: pw, h: ph };
  }
  return off;
}

function drawCaption(g, text) {
  g.font = `600 44px ${FONT}`;
  const lines = wrap(g, text, 1600).slice(0, 2);
  const lh = 58, pad = 22, boxH = lines.length * lh + pad * 2;
  const boxW = Math.max(...lines.map((l) => g.measureText(l).width)) + 64;
  const y0 = H - 40 - boxH;
  g.fillStyle = C.capBg; rr(g, (W - boxW) / 2, y0, boxW, boxH, 14); g.fill();
  g.fillStyle = C.capFg; g.textAlign = 'center'; g.textBaseline = 'top';
  lines.forEach((l, i) => g.fillText(l, W / 2, y0 + pad + i * lh + 4));
}

async function build() {
  const narration = await fetch(asset('narration.json')).then((r) => r.json());
  await document.fonts.load(`600 40px "Inter Variable"`);
  await document.fonts.load(`400 40px "Inter Variable"`);
  const images = {};
  for (const s of script.scenes) if (s.visual.type === 'shot') images[s.visual.src] = await loadImage(s.visual.src);
  const cmp = script.scenes.find((s) => s.visual.type === 'compare').visual;
  const original = await loadVideo(cmp.still);
  await seek(original, cmp.stillAt);
  const still = document.createElement('canvas'); still.width = 1280; still.height = 720;
  still.getContext('2d').drawImage(original, 0, 0, 1280, 720);
  const safe = await loadVideo(cmp.video);
  await seek(safe, cmp.videoFrom);

  const ac = new AudioContext();
  const buffers = {};
  for (const n of narration) buffers[n.file] = await fetch(asset(n.file)).then((r) => r.arrayBuffer()).then((b) => ac.decodeAudioData(b));

  let t = LEAD_IN;
  const scenes = script.scenes.map((s, si) => {
    const start = si === 0 ? 0 : t;
    const cues = s.lines.map((l, i) => {
      const n = narration.find((x) => x.scene === s.id && x.index === i);
      const cue = { start: t, end: t + n.duration, text: l.caption || l.say, file: n.file };
      t += n.duration + (i < s.lines.length - 1 ? LINE_GAP : SCENE_GAP);
      return cue;
    });
    if (s.minDuration) t = Math.max(t, start + s.minDuration);
    return { ...s, start, end: t, cues };
  });
  const total = t + TAIL;
  const assets = { images, still };
  for (const s of scenes) s.layer = renderStatic(s, assets);
  return { scenes, total, safe, ac, buffers };
}

function frame(st, t) {
  const scene = st.scenes.find((s) => t >= s.start && t < s.end) ?? st.scenes[st.scenes.length - 1];
  main.drawImage(scene.layer, 0, 0);
  if (scene.visual.type === 'compare') {
    const r = scene.videoRect;
    // Only the real recording plays the clip; it stops (holds) at videoTo, before the
    // sample's 2 Hz white section, so nothing in this demo flashes.
    if (st.recording && !scene.started) {
      scene.started = true; st.safe.currentTime = scene.visual.videoFrom; st.safe.play();
    }
    if (!st.safe.paused && st.safe.currentTime >= scene.visual.videoTo) st.safe.pause();
    main.save(); rr(main, r.x, r.y, r.w, r.h, 16); main.clip(); main.drawImage(st.safe, r.x, r.y, r.w, r.h); main.restore();
    main.strokeStyle = C.border; main.lineWidth = 2; rr(main, r.x, r.y, r.w, r.h, 16); main.stroke();
  }
  const cue = scene.cues.find((c) => t >= c.start && t < c.end + 0.25);
  if (cue) drawCaption(main, cue.text);
}

const st = await build().catch((e) => { setStatus('ERROR ' + e.message); window.__demo = { status: 'error', error: e.message }; throw e; });
frame(st, 0);
setStatus(`ready: ${st.scenes.length} scenes, ${st.total.toFixed(1)}s`);
window.__demo = {
  status: 'ready',
  total: st.total,
  cues: st.scenes.flatMap((s) => s.cues.map(({ start, end, text }) => ({ start, end, text }))),
};

// Preview any moment without recording: __demo.preview(42.5)
window.__demo.preview = (t) => { frame(st, t); return canvas.toDataURL('image/jpeg', 0.85); };

async function record() {
  const { ac } = st;
  await ac.resume();
  const stream = canvas.captureStream(30);
  const dest = ac.createMediaStreamDestination();
  dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));

  // Reset the before/after clip in case a preview touched it.
  st.safe.pause();
  const cmp = st.scenes.find((s) => s.visual.type === 'compare');
  cmp.started = false;
  await seek(st.safe, cmp.visual.videoFrom);
  st.recording = true;
  frame(st, 0);
  const t0 = ac.currentTime + 0.25;
  for (const s of st.scenes) for (const c of s.cues) {
    const src = ac.createBufferSource(); src.buffer = st.buffers[c.file]; src.connect(dest); src.start(t0 + c.start);
  }
  rec.start(1000);
  window.__demo.status = 'recording';
  await new Promise((resolve) => {
    const tick = () => {
      const t = Math.max(0, ac.currentTime - t0);
      frame(st, t);
      window.__demo.progress = t / st.total;
      setStatus(`recording ${t.toFixed(1)} / ${st.total.toFixed(1)}s`);
      if (t >= st.total) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop(); await stopped;
  const blob = new Blob(chunks, { type: rec.mimeType });
  window.__demo.blob = blob;
  window.__demo.url = URL.createObjectURL(blob);
  window.__demo.size = blob.size;
  window.__demo.status = 'done';
  setStatus(`done: ${(blob.size / 1e6).toFixed(1)} MB`);
}

// Base64 chunk reader so a driver can copy the file out in pieces.
window.__demo.chunk = async (i, size = 4 * 1024 * 1024) => {
  const part = window.__demo.blob.slice(i * size, (i + 1) * size);
  if (!part.size) return '';
  return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(new Blob([part], { type: 'application/octet-stream' })); });
};

document.getElementById('record').addEventListener('click', () => record().catch((e) => { window.__demo.status = 'error'; window.__demo.error = e.message; setStatus('ERROR ' + e.message); }));
