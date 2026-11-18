# FlashGuard

**Every student can watch the lesson.**

FlashGuard checks lesson videos for flashing that can trigger photosensitive seizures, helps the teacher describe each flashing part, and exports a safer copy. It runs entirely in the browser. Videos never leave the device.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # detection unit tests (Node)
npm run build    # static site in dist/
```

Deploy: push to GitHub and enable Pages with "GitHub Actions" as the source (workflow in `.github/workflows/deploy.yml`), or import the repo in Vercel (framework: Vite, no other settings needed). `vite.config.js` uses a relative base, so either works.

## How it works

| File | Job |
|---|---|
| `src/detect.js` | Pure detection core. **All thresholds live in `CONFIG` at the top.** |
| `src/analyze.js` | Seeks a hidden `<video>` at 30 fps, draws each frame to a 160px-wide canvas, feeds pixels to the detector |
| `src/export.js` | Re-renders through canvas + `MediaRecorder` with mitigation and captions |
| `src/sample.js` | Generates the synthetic test video off-screen |
| `src/main.js` | UI, safe preview guard, content warning |

1. Each frame is split into a grid (16 columns, rows by aspect ratio). Each cell gets its mean **linear** RGB (sRGB → linear), then relative luminance `0.2126R + 0.7152G + 0.0722B` and a red value `(R−G−B)×320`, which counts only when `R/(R+G+B) ≥ 0.8`.
2. Each cell tracks its last brightness extreme. It registers a **transition** when it swings back by ≥ 0.1 luminance with the darker state < 0.8 (general), or by ≥ 20 red value (red).
3. A frame-level transition counts when cells covering ≥ 25% of the frame transition on that frame, and only if it is opposite in direction to the previous counted one.
4. A flash is 2 opposing transitions. Any 1-second sliding window with more than 6 transitions (more than 3 flashes) of either type fails. Failing windows within 0.5s merge into one segment.

After export, FlashGuard re-analyzes the safe copy and reports whether it passes.

## Simplifications (on purpose, for a hackathon build)

- **Area is "≥ 25% of the frame"**, as in the brief. WCAG's real small-area test (a 341×256 px block at 1024×768, i.e. ~10° of central vision) depends on screen size and viewing distance.
- **Grid-cell averages, not per-pixel.** 16 columns × rows by aspect ratio. Flashing smaller than a cell, or a fine checkerboard inside a cell, averages out and can be missed.
- **Transitions must land on the same sampled frame** across cells to add up to 25%. Flashes that sweep across the screen over several frames can be undercounted.
- **Red uses cell-mean linear RGB**, not per-pixel chromaticity as in ITU-R BT.1702 / Harding.
- **Fixed 30 fps sampling.** 60 fps content is sub-sampled; single-frame flashes between samples can be missed.
- **A cell's tracker resets after 1 s without change**, so a flash after a long pause (black → calm → white) counts from its first frame. Harding treats extremes slightly differently.
- **No spatial-pattern (stripes/checkerboard) detection.** WCAG 2.3.1 doesn't require it; broadcast standards do.
- This is a screening tool, not a certification. Use a certified analyser (e.g. PEAT, Harding FPA) for anything high-stakes.

## Testing

```bash
npm test             # detection unit tests (Node, no browser)
npm run dev          # then, in another terminal:
npm run e2e:sample   # sample video through the real UI, both export modes, frame-level check of the output
npm run e2e:long     # 30 s 1280×720 clip with audio and sparse keyframes: timings + output check
```

The e2e scripts drive gstack's headless browser (`$B`). `tests/e2e/harness.js` decodes the exported file frame by frame and checks: playable with finite duration, frozen picture inside each part, no raw flash frames within ±0.1 s of each part, caption present, motion outside the parts, audio decoded. `tests/e2e/axe-run.js` runs axe-core (WCAG 2.2 A/AA + best practices), optionally with dark-theme colours forced.

Last results (headless Chromium 158, Apple Silicon):

| Check | Result |
|---|---|
| Sample: 6 Hz red flagged | 5.00–7.03 s (true 5.0–7.0), red + general, 6 flashes/s |
| Sample: 2 Hz white | not flagged |
| 30 s clip: 8 Hz red / 5 Hz white flagged | 8.00–11.03 s and 17.00–19.03 s (true 8–11, 17–19) |
| 30 s clip: 2 Hz white | not flagged |
| Analysis speed | 12 s 640×360: ~3 s. 30 s 1280×720: 25–38 s |
| Export | real time + re-check (30 s clip: ~46 s total) |
| Exported file | plays, frozen + captioned, 0 leaked flash frames, audio kept, re-check passes |
| axe | 0 violations on every screen, light and dark |

## Demo video

`demo/flashguard-demo.webm` (2:06, 1920×1080, voiceover + burned-in captions; `demo/flashguard-demo.srt` / `.vtt` for YouTube) is generated, not recorded by hand:

```bash
python3 tools/demo/make-narration.py   # macOS `say` → tools/demo/assets/voice/*.wav
npm run dev                            # in another terminal
tools/demo/record.sh                   # renders tools/demo/compositor.html in real time
```

The script and captions live in `tools/demo/script.json`. The original hazard clip only appears as a still frame, and the finished demo passes FlashGuard's own check (0 flashing parts).

## Known limitations

- **Analysis is slow on long or high-resolution videos.** Every sampled frame is a seek: about 30–40 ms per frame at 720p, so a 10-minute lesson takes roughly 5–7 minutes to check. Playback-based sampling was faster but dropped frames even at 2×, which can hide flashes, so we kept seeking.
- **Export runs in real time** (10-minute video ≈ 10 minutes) and the tab must stay open and visible. Browsers throttle hidden tabs and the render stalls.
- **Mitigation is padded by 0.25 s** each side of a part, to cover detection granularity and decode lag. The frozen picture is the last frame *before* the part (the first frame inside is itself a flash state). If a part starts at 0:00, the frame just after it is used.
- **"Reduce flashing" is not guaranteed safe** for extreme content. It passed the re-check on our tests; the re-check after export will tell you if it doesn't. "Pause and describe" is the default.
- **Audio** is kept via Web Audio. If the browser blocks sound during export, the copy is silent and the app says so. Verified in Chromium only.
- **Output is WebM** (VP9/VP8 + Opus) where supported. Safari would record MP4; **Safari and Firefox were not tested.**
- **No MP4 from a real camera or YouTube was tested** (no ffmpeg on the test machine). Test clips were WebM made by MediaRecorder, including one with sparse keyframes as a worst case for seeking. Real H.264 files with B-frames or variable frame rate may behave differently.
- **Not tested with a real screen reader** (VoiceOver/NVDA). Keyboard-only use and axe were tested; live-region wording was checked as text only.
- **Captions for the original video** are the teacher's responsibility: the preview player shows the teacher's own file, which may have no caption track (axe flags this for manual review).
- Very large files are held in memory as blobs; multi-GB files may exhaust browser memory.

## Accessibility of the app

- No animations or transitions anywhere (`animation: none; transition: none` globally). Nothing in the UI flashes.
- The sample is generated on an off-screen canvas. Flashing is never shown during generation, analysis or export.
- The preview never autoplays. On play or seek, a guard pauses before any flagged part and opens a modal warning (Skip / Watch anyway / Stay paused).
- Fully keyboard operable, visible 3px focus ring, skip link, labelled controls, `role="status"` live region for progress and results, focus moves to each new screen's heading.
- Verdicts use text and icons, not only colour. Timeline marks use stripes, and the segment list mirrors the timeline for screen-reader users.
- AA contrast in light and dark mode.
