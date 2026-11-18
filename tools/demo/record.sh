#!/usr/bin/env bash
# Records the demo video (real time, ~2 min) and writes demo/flashguard-demo.{webm,srt,vtt}.
# Needs: npm run dev (port 5173), gstack headless browser ($B), and narration from make-narration.py.
set -u
B="${B:-$HOME/.claude/skills/gstack/browse/dist/browse}"
URL="${URL:-http://localhost:5173}/tools/demo/compositor.html"
OUT="$(cd "$(dirname "$0")/../.." && pwd)/demo"; mkdir -p "$OUT"
TMP="$(mktemp -d)"
$B goto about:blank >/dev/null; $B goto "$URL" >/dev/null
for _ in $(seq 1 30); do sleep 1; s=$($B js "window.__demo ? window.__demo.status : 'loading'"); case "$s" in ready|error) break;; esac; done
[ "$s" = ready ] || { echo "compositor not ready: $s"; exit 1; }
$B click "#record" >/dev/null
for _ in $(seq 1 60); do sleep 4; s=$($B js "window.__demo.status"); case "$s" in done|error) break;; esac; done
[ "$s" = done ] || { echo "recording failed: $s"; exit 1; }
n=$($B js "Math.ceil(__demo.size / (4*1024*1024))")
for i in $(seq 0 $((n-1))); do $B js "__demo.chunk($i)" --out "$TMP/part-$(printf %03d "$i").bin" >/dev/null; done
cat "$TMP"/part-*.bin > "$OUT/flashguard-demo.webm"
$B js "JSON.stringify(__demo.cues)" > "$TMP/cues.json"
python3 - "$TMP/cues.json" "$OUT" <<'PY'
import json, sys
cues = json.load(open(sys.argv[1])); out = sys.argv[2]
def ts(t, sep):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h:02d}:{m:02d}:{int(s):02d}{sep}{int(round((s - int(s)) * 1000)):03d}"
off = 0.25  # cue clock starts 0.25 s after the recorder
srt, vtt = [], ['WEBVTT', '']
for i, c in enumerate(cues, 1):
    a, b = c['start'] + off, c['end'] + off + 0.25
    srt += [str(i), f"{ts(a, ',')} --> {ts(b, ',')}", c['text'], '']
    vtt += [f"{ts(a, '.')} --> {ts(b, '.')}", c['text'], '']
open(f'{out}/flashguard-demo.srt', 'w').write('\n'.join(srt))
open(f'{out}/flashguard-demo.vtt', 'w').write('\n'.join(vtt))
PY
rm -rf "$TMP"
ls -la "$OUT"
