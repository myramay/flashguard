// Node test: feed the detector the same synthetic timeline as the in-browser sample.
import assert from 'node:assert/strict';
import { createAnalyzer, CONFIG } from '../src/detect.js';

const W = 32, H = 18, FPS = CONFIG.sampleFps;

function solid(r, g, b) {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < a.length; i += 4) { a[i] = r; a[i + 1] = g; a[i + 2] = b; a[i + 3] = 255; }
  return a;
}
const calm = solid(70, 110, 140);
const red = solid(255, 0, 0);
const black = solid(0, 0, 0);
const white = solid(255, 255, 255);

function run(timeline) {
  const an = createAnalyzer(W, H);
  const total = timeline.reduce((s, p) => s + p.d, 0);
  const n = Math.floor(total * FPS);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / FPS;
    let acc = 0, part;
    for (part of timeline) { if (t < acc + part.d) break; acc += part.d; }
    const local = t - acc;
    let frame = calm;
    if (part.hz) frame = Math.floor(local * part.hz * 2) % 2 === 0 ? part.on : black;
    an.push(frame, t);
  }
  return an.finish(total);
}

// The sample video: 5s calm, 2s red/black at 6Hz, 3s calm, 2s white/black at 2Hz
const r = run([
  { d: 5 }, { d: 2, hz: 6, on: red }, { d: 3 }, { d: 2, hz: 2, on: white },
]);
console.log(JSON.stringify(r.segments, null, 1));
assert.equal(r.pass, false);
assert.equal(r.segments.length, 1, 'only the 6Hz red section should fail');
const s = r.segments[0];
assert.ok(s.start >= 4.9 && s.start <= 5.2, `start ${s.start}`);
assert.ok(s.end >= 6.7 && s.end <= 7.2, `end ${s.end}`);
assert.equal(s.type, 'red');
assert.ok(s.kinds.includes('general'));
assert.ok(s.flashesPerSecond >= 5, `fps ${s.flashesPerSecond}`);
assert.equal(s.areaPercent, 100);

// 2.5Hz white flashing (5 transitions/s, plus 1 entering) passes; 4Hz fails.
assert.equal(run([{ d: 1 }, { d: 3, hz: 2.5, on: white }, { d: 1 }]).pass, true, "2.5Hz passes");
assert.equal(run([{ d: 1 }, { d: 3, hz: 4, on: white }, { d: 1 }]).pass, false, '4Hz fails');
// Dim flashing below the 0.1 luminance change should pass.
const dim = solid(20, 20, 20);
assert.equal(run([{ d: 1 }, { d: 3, hz: 8, on: dim }, { d: 1 }]).pass, true, 'tiny change passes');

// Regression: a second flashing part that begins with the same direction of change as the
// last transition counted (seconds earlier) must still be detected from its first flash.
const two = run([{ d: 1 }, { d: 2, hz: 6, on: red }, { d: 3 }, { d: 2, hz: 5, on: white }, { d: 2 }]);
assert.equal(two.segments.length, 2, 'two flashing parts');
assert.ok(Math.abs(two.segments[1].start - 6) <= 0.04, `second start ${two.segments[1].start}`);
assert.ok(Math.abs(two.segments[1].end - 8) <= 0.15, `second end ${two.segments[1].end}`);

console.log('All detection tests passed.');
