import './style.css';
import { analyzeVideo } from './analyze.js';
import { makeSampleVideo } from './sample.js';
import { exportSafeVideo } from './export.js';
import { formatRange, formatTime, fixDuration } from './video.js';

const $ = (sel) => document.querySelector(sel);
const els = {
  intro: $('#intro'),
  introHeading: $('#intro-heading'),
  introError: $('#intro-error'),
  dropzone: $('#dropzone'),
  fileInput: $('#file-input'),
  chooseBtn: $('#choose-btn'),
  sampleBtn: $('#sample-btn'),
  working: $('#working'),
  workingHeading: $('#working-heading'),
  workingFile: $('#working-file'),
  progress: $('#progress'),
  progressLabel: $('#progress-label'),
  cancelBtn: $('#cancel-btn'),
  results: $('#results'),
  resultsHeading: $('#results-heading'),
  verdict: $('#verdict'),
  preview: $('#preview'),
  timeline: $('#timeline'),
  playhead: $('#playhead'),
  timelineEnd: $('#timeline-end'),
  segmentsSection: $('#segments-section'),
  segments: $('#segments'),
  exportSection: $('#export-section'),
  exportBtn: $('#export-btn'),
  exportWrap: $('#export-progress-wrap'),
  exportProgress: $('#export-progress'),
  exportLabel: $('#export-label'),
  exportStatus: $('#export-status'),
  downloadLink: $('#download-link'),
  recheckStatus: $('#recheck-status'),
  warningSection: $('#warning-section'),
  warningText: $('#warning-text'),
  copyBtn: $('#copy-btn'),
  restartBtn: $('#restart-btn'),
  live: $('#live'),
  dialog: $('#warn-dialog'),
  dialogDesc: $('#warn-desc'),
};

const state = {
  file: null,
  url: null,
  result: null,
  acknowledged: new Set(),
  abort: null,
  exportUrl: null,
  busy: false,
};

// ---------- helpers ----------
function announce(msg) {
  els.live.textContent = '';
  // A short delay makes screen readers re-read identical messages.
  setTimeout(() => (els.live.textContent = msg), 60);
}

function show(screen) {
  els.intro.hidden = screen !== 'intro';
  els.working.hidden = screen !== 'working';
  els.results.hidden = screen !== 'results';
  const heading = { intro: els.introHeading, working: els.workingHeading, results: els.resultsHeading }[screen];
  heading.focus();
}

function makeProgress(labelEl, barEl, prefix) {
  let lastAnnounced = -1;
  return (frac) => {
    const pct = Math.round(frac * 100);
    barEl.value = pct;
    labelEl.textContent = `${prefix} ${pct}%`;
    const step = Math.floor(pct / 25);
    if (step !== lastAnnounced && pct < 100) {
      lastAnnounced = step;
      if (pct > 0) announce(`${prefix} ${pct}%`);
    }
  };
}

function listJoin(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function typeLabel(seg) {
  if (seg.kinds.length === 2) return 'Red flash and general flash';
  return seg.type === 'red' ? 'Red flash' : 'General flash (light and dark)';
}

function draftDescription(seg) {
  const where = seg.areaPercent >= 75 ? 'the whole screen' : seg.areaPercent >= 40 ? 'a large part of the screen' : 'part of the screen';
  const what = seg.type === 'red' ? 'flashes bright red' : 'flashes between light and dark';
  return `${where[0].toUpperCase()}${where.slice(1)} ${what} quickly, about ${Math.round(seg.flashesPerSecond)} times a second.`;
}

function segmentAt(t, lead = 0) {
  return state.result?.segments.find((s) => t >= s.start - lead && t < s.end);
}

// ---------- choosing a video ----------
function showIntroError(msg) {
  els.introError.textContent = msg;
  els.introError.hidden = !msg;
}

els.chooseBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => {
  const f = els.fileInput.files?.[0];
  if (f) startAnalysis(f);
  els.fileInput.value = '';
});

['dragenter', 'dragover'].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('dragover');
  }),
);
['dragleave', 'drop'].forEach((ev) =>
  els.dropzone.addEventListener(ev, () => els.dropzone.classList.remove('dragover')),
);
els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('video/')) ?? e.dataTransfer?.files?.[0];
  if (f) startAnalysis(f);
});
// Let the whole page accept drops without the browser navigating to the file.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

els.sampleBtn.addEventListener('click', async () => {
  if (state.busy) return;
  showIntroError('');
  state.busy = true;
  state.abort = new AbortController();
  els.workingFile.textContent = 'Making a sample video in your browser (about 12 seconds). It will not be shown while it is made.';
  els.progress.value = 0;
  show('working');
  try {
    const file = await makeSampleVideo({ onProgress: makeProgress(els.progressLabel, els.progress, 'Making the sample:') });
    state.busy = false;
    if (state.abort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    await startAnalysis(file);
  } catch (err) {
    state.busy = false;
    handleError(err);
  }
});

els.cancelBtn.addEventListener('click', () => state.abort?.abort());

function handleError(err) {
  show('intro');
  if (err?.name === 'AbortError') {
    announce('Cancelled.');
    return;
  }
  console.error(err);
  showIntroError(err?.message || 'Something went wrong while reading this video.');
}

// ---------- analysis ----------
async function startAnalysis(file) {
  if (state.busy) return;
  if (file.type && !file.type.startsWith('video/')) {
    showIntroError('That file is not a video. Please choose an MP4 or WebM file.');
    return;
  }
  showIntroError('');
  state.busy = true;
  state.file = file;
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = URL.createObjectURL(file);
  state.acknowledged.clear();
  state.abort = new AbortController();
  els.workingFile.textContent = `File: ${file.name}`;
  els.progress.value = 0;
  els.progressLabel.textContent = 'Checking frames: 0%';
  show('working');
  announce(`Checking ${file.name}. This may take a moment.`);
  try {
    state.result = await analyzeVideo(state.url, {
      onProgress: makeProgress(els.progressLabel, els.progress, 'Checking frames:'),
      signal: state.abort.signal,
    });
    renderResults();
  } catch (err) {
    handleError(err);
  } finally {
    state.busy = false;
  }
}

// ---------- results ----------
function renderResults() {
  const { segments, duration, pass } = state.result;
  const n = segments.length;

  els.verdict.className = `verdict ${pass ? 'pass' : 'fail'}`;
  if (pass) {
    els.verdict.innerHTML = `
      <p class="verdict-title"><span aria-hidden="true">✓</span> Passes the flash check</p>
      <p>We did not find any part with more than 3 flashes in one second.</p>
      <p class="small">This is an automatic, simplified check of WCAG 2.3.1, not a guarantee.</p>`;
  } else {
    els.verdict.innerHTML = `
      <p class="verdict-title"><span aria-hidden="true">✕</span> Does not pass: ${n} flashing ${n === 1 ? 'part' : 'parts'} found</p>
      <p>${n === 1 ? 'This part has' : 'These parts have'} more than 3 flashes in one second, which can trigger seizures.
      Describe ${n === 1 ? 'it' : 'each one'} below, then export a safe version.</p>`;
  }

  // Preview player: always paused, never autoplay.
  els.preview.autoplay = false;
  els.preview.src = state.url;
  els.preview.pause();
  els.preview.addEventListener('loadedmetadata', () => fixDuration(els.preview), { once: true });

  // Timeline
  els.timeline.querySelectorAll('.mark').forEach((m) => m.remove());
  for (const seg of segments) {
    const mark = document.createElement('div');
    mark.className = 'mark';
    mark.style.left = `${(seg.start / duration) * 100}%`;
    mark.style.width = `${((seg.end - seg.start) / duration) * 100}%`;
    mark.title = `Flashing ${formatRange(seg)}`;
    mark.addEventListener('click', () => goToSegment(seg));
    els.timeline.appendChild(mark);
  }
  els.playhead.style.left = '0%';
  els.timelineEnd.textContent = formatTime(duration);

  // Segment list
  els.segments.innerHTML = '';
  segments.forEach((seg, i) => {
    const li = document.createElement('li');
    li.className = 'segment';
    const range = formatRange(seg);
    const descId = `desc-${i}`;
    li.innerHTML = `
      <h4>Part ${i + 1}: ${range}</h4>
      <dl>
        <div><dt>Type</dt><dd>${typeLabel(seg)}</dd></div>
        <div><dt>Flashes per second (highest)</dt><dd>${seg.flashesPerSecond.toFixed(1)}</dd></div>
        <div><dt>Screen affected</dt><dd>${seg.areaPercent}%</dd></div>
      </dl>
      <button type="button" class="btn secondary small-btn" data-go="${i}">Go to this part (stays paused)</button>
      <label for="${descId}">What happens on screen in this part?</label>
      <textarea id="${descId}" rows="2" data-desc="${i}" aria-describedby="${descId}-hint"></textarea>
      <p id="${descId}-hint" class="small muted">We wrote a first draft. Edit it to describe the lesson content, for example "The flame flashes bright green 4 times."</p>`;
    li.querySelector('textarea').value = draftDescription(seg);
    li.querySelector('[data-go]').addEventListener('click', () => goToSegment(seg));
    els.segments.appendChild(li);
  });

  els.segmentsSection.hidden = pass;
  els.exportSection.hidden = pass;
  els.warningSection.hidden = pass;
  els.exportStatus.textContent = '';
  els.recheckStatus.textContent = '';
  els.downloadLink.hidden = true;
  els.exportWrap.hidden = true;
  els.exportBtn.disabled = false;
  updateWarningText();

  show('results');
  announce(
    pass
      ? 'Check finished. The video passes. No flashing parts were found.'
      : `Check finished. The video does not pass. ${n} flashing ${n === 1 ? 'part was' : 'parts were'} found: ${listJoin(segments.map(formatRange))}.`,
  );
}

function goToSegment(seg) {
  els.preview.pause();
  // Stop just before the part, so the paused picture is not itself a flash frame.
  els.preview.currentTime = Math.max(0, seg.start - 0.3);
  announce(`Moved to just before ${formatRange(seg)}. The video is paused. If you press play, we will warn you first.`);
}

function updateWarningText() {
  const segs = state.result?.segments ?? [];
  els.warningText.value = segs.length
    ? `This video contains flashing at ${listJoin(segs.map(formatRange))}. A seizure-safe version is available.`
    : '';
}

// ---------- safe preview: warn before flashing ----------
let pendingSeg = null;
function guard() {
  if (els.preview.paused || els.dialog.open) return;
  const seg = segmentAt(els.preview.currentTime, 0.3);
  if (seg && !state.acknowledged.has(seg.id)) {
    els.preview.pause();
    pendingSeg = seg;
    els.dialogDesc.textContent = `The part from ${formatRange(seg)} has fast flashing (${typeLabel(seg).toLowerCase()}, about ${Math.round(seg.flashesPerSecond)} flashes a second). It could trigger a seizure in some people.`;
    els.dialog.showModal();
  }
}
function guardLoop() {
  guard();
  if (!els.preview.paused) requestAnimationFrame(guardLoop);
}
els.preview.addEventListener('play', () => {
  guard();
  requestAnimationFrame(guardLoop);
});
els.preview.addEventListener('seeked', guard);
els.preview.addEventListener('timeupdate', () => {
  const d = state.result?.duration || els.preview.duration;
  if (d) els.playhead.style.left = `${Math.min(100, (els.preview.currentTime / d) * 100)}%`;
});

els.dialog.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action || !pendingSeg) return;
  const seg = pendingSeg;
  els.dialog.close();
  if (action === 'skip') {
    els.preview.currentTime = Math.min(seg.end + 0.05, els.preview.duration || seg.end);
    els.preview.play();
    announce(`Skipped to ${formatRange({ start: seg.end, end: seg.end }).split('–')[0]}.`);
  } else if (action === 'watch') {
    state.acknowledged.add(seg.id);
    els.preview.play();
    announce(`Playing the flashing part, ${formatRange(seg)}.`);
  } else {
    announce('Video paused.');
  }
  pendingSeg = null;
});
els.dialog.addEventListener('cancel', () => {
  pendingSeg = null;
  announce('Video paused.');
});

// ---------- export ----------
els.exportBtn.addEventListener('click', async () => {
  if (state.busy || !state.result) return;
  const segs = state.result.segments;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const descriptions = segs.map((_, i) => document.querySelector(`[data-desc="${i}"]`).value);
  state.busy = true;
  els.exportBtn.disabled = true;
  els.exportWrap.hidden = false;
  els.exportStatus.textContent = '';
  els.recheckStatus.textContent = '';
  els.downloadLink.hidden = true;
  els.exportProgress.value = 0;
  announce('Making the safe version. This takes about as long as the video.');
  try {
    const { blob, ext, audioNote } = await exportSafeVideo(state.url, segs, {
      mode,
      descriptions,
      onProgress: makeProgress(els.exportLabel, els.exportProgress, 'Making the safe version:'),
    });
    if (state.exportUrl) URL.revokeObjectURL(state.exportUrl);
    state.exportUrl = URL.createObjectURL(blob);
    const base = (state.file?.name || 'video').replace(/\.[^.]+$/, '');
    const filename = `${base}-flashguard-safe.${ext}`;
    els.downloadLink.href = state.exportUrl;
    els.downloadLink.download = filename;
    els.downloadLink.hidden = false;
    els.downloadLink.click(); // start the download
    els.exportWrap.hidden = true;
    els.exportStatus.textContent = `Done. "${filename}" is downloading.${audioNote ? ` ${audioNote}` : ''}`;
    announce(els.exportStatus.textContent + ' Now double-checking the safe version.');
    await recheck();
  } catch (err) {
    console.error(err);
    els.exportWrap.hidden = true;
    els.exportStatus.textContent = `Export did not finish: ${err.message || err}`;
    announce(els.exportStatus.textContent);
  } finally {
    state.busy = false;
    els.exportBtn.disabled = false;
  }
});

async function recheck() {
  els.recheckStatus.textContent = 'Double-checking the safe version…';
  try {
    const r = await analyzeVideo(state.exportUrl, {
      onProgress: (f) => (els.recheckStatus.textContent = `Double-checking the safe version: ${Math.round(f * 100)}%`),
    });
    els.recheckStatus.textContent = r.pass
      ? '✓ Double-check: the safe version passes the flash check.'
      : `Double-check: the safe version still has ${r.segments.length} flashing part(s) at ${listJoin(r.segments.map(formatRange))}. Try "Pause and describe".`;
  } catch (err) {
    els.recheckStatus.textContent = 'We could not double-check the safe version in this browser.';
  }
  announce(els.recheckStatus.textContent);
}

// ---------- content warning ----------
els.copyBtn.addEventListener('click', async () => {
  const text = els.warningText.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    els.warningText.select();
    document.execCommand('copy');
  }
  els.copyBtn.textContent = 'Copied';
  announce('Content warning copied.');
  setTimeout(() => (els.copyBtn.textContent = 'Copy content warning'), 2500);
});

els.restartBtn.addEventListener('click', () => {
  els.preview.pause();
  els.preview.removeAttribute('src');
  els.preview.load();
  state.result = null;
  show('intro');
});

// Debug hook for automated end-to-end checks.
window.__flashguard = state;
