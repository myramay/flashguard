#!/usr/bin/env bash
# E2E: sample video through the real UI, export, and frame-level inspection of the output.
# Needs the dev server (npm run dev) and gstack's headless browser ($B).
# Usage: tests/e2e/run-sample.sh [freeze|smooth] [out.png]
set -u
B="${B:-$HOME/.claude/skills/gstack/browse/dist/browse}"
URL="${URL:-http://localhost:5173}"
MODE="${1:-freeze}"; OUT="${2:-/tmp/fg-sample-$MODE.png}"
poll() { for _ in $(seq 1 "${2:-60}"); do sleep 2; s=$($B js "$1"); case "$s" in *DONE*) echo "$s"; return;; esac; done; echo "TIMEOUT: $s"; }
$B goto "$URL" >/dev/null; $B console --clear >/dev/null
$B js "window.__t0=performance.now(); document.querySelector('#sample-btn').click(); 'ok'" >/dev/null
echo "ANALYSIS: $(poll "document.querySelector('#results').hidden ? 'wait' : 'DONE ' + ((performance.now()-window.__t0)/1000).toFixed(1) + 's (incl. 12s sample generation)'")"
echo "SEGMENTS: $($B js "JSON.stringify(__flashguard.result.segments, ['start','end','type','flashesPerSecond','areaPercent'])")"
$B js "document.querySelector('#mode-$MODE').checked=true; document.querySelector('#export-btn').click(); window.__t1=performance.now(); 'ok'" >/dev/null
echo "EXPORT: $(poll "/Double-check:|could not|did not finish/.test(document.querySelector('#recheck-status').textContent + document.querySelector('#export-status').textContent) ? 'DONE ' + ((performance.now()-__t1)/1000).toFixed(1)+'s | ' + document.querySelector('#recheck-status').textContent : 'wait'")"
$B js "import('/tests/e2e/harness.js').then(m => { m.inspectExport(__flashguard.exportUrl, __flashguard.result.segments); return 'started' })" >/dev/null
echo "INSPECT: $(poll "window.__e2e?.inspect?.status === 'done' ? 'DONE ' + JSON.stringify(__e2e.inspect.report) : 'wait'" 30)"
$B js "__e2e.inspect.snapshot" --out "$OUT" >/dev/null && echo "SNAPSHOT: $OUT"
echo "CONSOLE: $($B console --errors | grep -v 'UNTRUSTED' | tr '\n' ' ')"
