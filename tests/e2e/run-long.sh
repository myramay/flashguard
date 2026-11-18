#!/usr/bin/env bash
# E2E performance: 30s 1280x720 clip with audio and sparse keyframes.
# Expected: fail at ~8–11s (red 8Hz) and ~17–19s (white 5Hz); 24–26s (white 2Hz) passes.
set -u
B="${B:-$HOME/.claude/skills/gstack/browse/dist/browse}"
URL="${URL:-http://localhost:5173}"
poll() { for _ in $(seq 1 "${2:-90}"); do sleep 2; s=$($B js "$1"); case "$s" in *DONE*) echo "$s"; return;; esac; done; echo "TIMEOUT: $s"; }
$B goto "$URL" >/dev/null; $B console --clear >/dev/null
$B js "import('/tests/e2e/harness.js').then(m => { window.__h = m; m.generateLong(); return 'started' })" >/dev/null
echo "GENERATE: $(poll "__e2e.long?.status === 'ready' ? 'DONE ' + __e2e.long.genSeconds.toFixed(1) + 's, ' + (__e2e.long.size/1e6).toFixed(1) + 'MB' : 'wait'")"
$B js "window.__t0 = performance.now(); __h.feedFile(__e2e.long.file); 'ok'" >/dev/null
echo "ANALYSIS: $(poll "document.querySelector('#results').hidden ? 'wait' : 'DONE ' + ((performance.now()-__t0)/1000).toFixed(1) + 's'")"
echo "SEGMENTS: $($B js "JSON.stringify(__flashguard.result.segments, ['start','end','type','flashesPerSecond','areaPercent'])")"
$B click "#export-btn" >/dev/null; $B js "window.__t1 = performance.now(); 'ok'" >/dev/null
echo "EXPORT: $(poll "/Double-check:|could not|did not finish/.test(document.querySelector('#recheck-status').textContent + document.querySelector('#export-status').textContent) ? 'DONE ' + ((performance.now()-__t1)/1000).toFixed(1)+'s (export + re-check) | ' + document.querySelector('#export-status').textContent + ' | ' + document.querySelector('#recheck-status').textContent : 'wait'" 120)"
$B js "__h.inspectExport(__flashguard.exportUrl, __flashguard.result.segments); 'started'" >/dev/null
echo "INSPECT: $(poll "window.__e2e?.inspect?.status === 'done' ? 'DONE ' + JSON.stringify(__e2e.inspect.report) : 'wait'" 40)"
echo "SOURCE_AUDIO_CHECK: $($B js "new Promise(r => { const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(__e2e.long.file); v.play().then(() => setTimeout(() => { r(String(v.webkitAudioDecodedByteCount)); v.pause(); }, 3000)); })")"
echo "CONSOLE: $($B console --errors | grep -v 'UNTRUSTED' | tr '\n' ' ')"
