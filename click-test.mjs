// click-test.mjs — automated click/pop regression harness.
//
// WHY THIS EXISTS: pop-probe.js detects clicks in a live browser by polling an
// analyser — good for Safari sessions, but it meant a human mashing keys and
// pasting logs. This harness feeds the REAL engine key events and inspects
// EVERY rendered sample for discontinuities, with no human.
//
// HOW: window.AudioContext is swapped for an OfflineAudioContext before the
// page loads, so the engine schedules its envelopes against a VIRTUAL clock.
// Rendering is suspended at each scripted key event (real KeyboardEvents with
// the app's e.code values), the event fires, rendering resumes. The finished
// buffer is scanned with the probe's click math:
//   d > 0.02 && d > 4 x leaky-slopeMax (LEAK 0.999) — full sample coverage,
//   deterministic, no analyser races, no realtime threads to starve.
// Frozen ctx.currentTime at every dispatch is the WORST-CASE stale-clock
// condition for envelope scheduling — the exact family of bug (ramps anchored
// in the past, GainNode's 1.0 default) this harness exists to catch.
//
// Self-certifying: two controls run first, pure WebAudio, no engine:
//   control:sine   clean sine must yield 0 hits  (recorder/detector integrity)
//   control:blast  replays the pop-probe v5 regression (source born under
//                  GainNode's default 1.0, pinned to 0 one LOOKAHEAD later)
//                  and MUST yield >=1 hit          (detector sensitivity)
// A run where blast misses is uncertified — "0 clicks" would be meaningless.
//
// WHAT IT DOES NOT PROVE: this is Chromium, not Safari, and virtual time
// cannot reproduce Safari's specific async clock-lag windows; it proves the
// engine SCHEDULES clicks, which fires in any browser. A green run means the
// engine rendered ~8s of scripted abuse with zero discontinuity samples.
//
// Usage: node click-test.mjs [name-substring...]   (npm run test:clicks)

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv.slice(2);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = (req.url === '/' ? '/index.html' : req.url.split('?')[0]);
  const p = path.join(ROOT, path.normalize(f).replace(/^([.][.][/\\])+/, ''));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html`;

const SR = 48000;
const RENDER_LEN = 5; // virtual seconds per engine scene

// Runs before any page script. Two jobs:
//  1. AudioContext -> OfflineAudioContext (fixed length) so the engine's
//     `new AudioContext()` is virtual. webkit alias patched too.
//  2. the click detector + scene/controls drivers, as page globals.
function install(o) {
  const len = o.len, sr = o.sr;
  window.__sr = sr;
  window.AudioContext = class extends OfflineAudioContext {
    constructor() {
      super(1, len * sr, sr);
      window.__ctx = this;
    }
  };
  window.webkitAudioContext = window.AudioContext;

  // debug knob: NO_LIMIT=1 truly bypasses the DynamicsCompressor (dummy
  // params so initAudio's setup still runs) — test whether the compressor's
  // internal lookahead/delay machinery is what distorts single samples
  if (o.nolimit) {
    AudioContext.prototype.createDynamicsCompressor = function () {
      const g = this.createGain();
      for (const p of ['threshold', 'knee', 'ratio', 'attack', 'release']) g[p] = { value: 0 };
      window.__bypassedLimiter = true;
      return g;
    };
  }

  // probe math over a COMPLETE rendered buffer (every sample, not polled)
  window.__detect = (buf) => {
    const LEAK = 0.9990;
    const hits = [];
    let slopeMax = 0.02, prev = 0, peak = 0, clips = 0; // seed carry at the floor:
    // empty leak at buffer start would flag a bare sine's first step
    for (let n = 1; n < buf.length; n++) {
      const x = buf[n];
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (a > 0.995) clips++;
      const d = Math.abs(x - prev);
      const carry = slopeMax * LEAK;
      if (d > 0.02 && d > 4 * carry && hits.length < 25) {
        const s = [];
        for (let j = Math.max(0, n - 24); j < Math.min(buf.length, n + 25); j += 2) {
          s.push(Math.round(buf[j] * 1000) / 1000);
        }
        const s1 = [];
        for (let j = Math.max(0, n - 10); j < Math.min(buf.length, n + 11); j++) {
          s1.push(Math.round(buf[j] * 1e5) / 1e5);
        }
        hits.push({ ms: +((n / window.__sr) * 1000).toFixed(2), d: +d.toFixed(3),
                    sample: n, slice: s.join(' '), fine: s1.join(' ') });
      }
      slopeMax = Math.max(d, carry);
      prev = x;
    }
    return { samples: buf.length, ms: +((buf.length / window.__sr) * 1000).toFixed(0),
             hits, peak: +peak.toFixed(3), clips };
  };

  // drive one scene: events = [[t, 'keydown'|'keyup', 'Code'], ...]
  window.__press = async (events) => {
    window.initAudio();
    const ctx = window.__ctx;
    events = events.slice().sort((a, b) => a[0] - b[0]); // stable: same-t order kept
    const groups = [];
    for (const e of events) {
      const g = groups[groups.length - 1];
      if (g && g.t === e[0]) g.ev.push(e); else groups.push({ t: e[0], ev: [e] });
    }
    const done = ctx.startRendering();
    for (const g of groups) {
      const sp = ctx.suspend(g.t); // registered before the render thread can pass t
      await sp;
      for (const [t, ty, code] of g.ev) {
        document.dispatchEvent(new KeyboardEvent(ty, { code, bubbles: true, cancelable: true }));
      }
      ctx.resume();
    }
    const buf = await done;
    return window.__detect(buf.getChannelData(0));
  };

  // controls on raw OfflineAudioContexts (never touch the engine)
  window.__controls = async () => {
    const out = {};
    { // 3) cancel+re-pin anchored EXACTLY at a block start (any browser's
      // currentTime is block-quantized, so this is what an unguarded release
      // does): MUST bump — proves sensitivity to the one-sample rollback
      // artifact; the engine's cancelHold uses the past-anchor form below.
      const c = new OfflineAudioContext(1, window.__sr, window.__sr);
      const o = c.createOscillator(); o.frequency.value = 100;
      const g = c.createGain();
      o.connect(g); g.connect(c.destination);
      g.gain.setValueAtTime(0.6, 0);
      g.gain.linearRampToValueAtTime(0.3, 3.0); // slow ramp we will cancel
      const B = (128 * 252) / window.__sr;      // exactly on a render-block start
      o.start();
      const pin = () => {
        const v = g.gain.value;
        g.gain.cancelScheduledValues(B);
        g.gain.setValueAtTime(v, B);
        g.gain.linearRampToValueAtTime(0, B + 0.3);
      };
      const sp = c.suspend(B);
      const done = c.startRendering();
      await sp; pin(); c.resume();
      out.boundaryPin = window.__detect((await done).getChannelData(0));
    }
    { // 4) THE ENGINE'S CURRENT FORM: never edit the live envelope; splice a
      // fresh unity gain node whose FIRST event pins its own current value.
      // MUST be clean — certifies the stage pattern the engine now uses.
      const c = new OfflineAudioContext(1, window.__sr, window.__sr);
      const o = c.createOscillator(); o.frequency.value = 100;
      const gA = c.createGain();
      o.connect(gA); gA.connect(c.destination);
      gA.gain.setValueAtTime(0.6, 0);
      gA.gain.linearRampToValueAtTime(0.3, 3.0); // gA envelope untouched from here
      const B = (128 * 252) / window.__sr;
      o.start();
      const sp = c.suspend(B);
      const done = c.startRendering();
      await sp;
      const gB = c.createGain(); // the stage
      gA.disconnect(); gA.connect(gB); gB.connect(c.destination);
      gB.gain.setValueAtTime(gB.gain.value, B); // first event == current value
      gB.gain.linearRampToValueAtTime(0, B + 0.3);
      c.resume();
      const buf = (await done).getChannelData(0);
      out.stageForm = window.__detect(buf);
      // LEVEL CONTINUITY: hits==0 passes on silence too (a bare disconnect()
      // after the splice orphans the stage and the note DIES silently — real
      // bug class, found by the slot-exhaustion scene). Compare mean |x| just
      // after the swap to just before: the slow fade may only shave ~15%.
      const mean = (a, b) => { let s = 0; for (let n = a; n < b; n++) s += Math.abs(buf[n]); return s / (b - a); };
      const at = Math.round(B * window.__sr);
      out.stageForm.levelRatio = +(mean(at + 64, at + 2048) / mean(at - 2048, at - 64)).toFixed(2);
    }
    { // clean sine: 0 hits expected
      const c = new OfflineAudioContext(1, window.__sr, window.__sr);
      const o = c.createOscillator(); o.frequency.value = 440;
      const g = c.createGain(); g.gain.value = 0.5;
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(0.6);
      out.sine = window.__detect((await c.startRendering()).getChannelData(0));
    }
    { // THE blast: source audible under GainNode's default 1.0, then pinned
      // to 0 one LOOKAHEAD later. DC buffer so both edges are ~1.0 —
      // guaranteed catchable regardless of wave phase.
      const c = new OfflineAudioContext(1, window.__sr, window.__sr);
      const b = c.createBuffer(1, window.__sr, window.__sr);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = 1;
      const src = c.createBufferSource(); src.buffer = b;
      const g = c.createGain(); // deliberately unpinned — born at 1.0
      src.connect(g); g.connect(c.destination);
      src.start(0.002);
      g.gain.setValueAtTime(0, 0.012);
      g.gain.linearRampToValueAtTime(0.3, 0.062);
      out.blast = window.__detect((await c.startRendering()).getChannelData(0));
    }
    return out;
  };
}

async function openPage(browser) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  [page error]', e.message));
  await page.addInitScript(install, { len: RENDER_LEN, sr: SR, nolimit: process.env.NO_LIMIT === '1' });
  await page.goto(URL_);
  return page;
}

// === scenarios: scripted virtual-time key scenes ===
function rng(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }
function spamEv(rand, n, t0 = 0.05) {
  const ev = []; let t = t0;
  for (let i = 0; i < n; i++) {
    ev.push([t, 'keydown', 'Space']);
    t += 0.025 + rand() * 0.035;
    ev.push([t, 'keyup', 'Space']);
    t += 0.015 + rand() * 0.05;
  }
  return ev;
}
const pressEv = (t, code) => [[t, 'keydown', code], [t, 'keyup', code]];

const SCENES = [
  { name: 'single-note', ev: () => [[0.05, 'keydown', 'Space'], [0.75, 'keyup', 'Space']] },
  { name: 'space-spam', ev: () => spamEv(rng(42), 24) },
  { name: 'chord-revoice', ev: () => {
    const ev = [[0.05, 'keydown', 'Space']];
    let t = 0.15;
    for (const c of ['KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote', 'KeyH']) {
      ev.push(...pressEv(t, c)); t += 0.09; // mid-note re-voicing
    }
    ev.push([t + 0.15, 'keyup', 'Space']);
    return ev;
  } },
  { name: 'additive-toggle', ev: () => {
    // 3 rounds over the 5 additive keys: every round toggles each voice
    // off then on again — heavy add/drop churn through the stage paths
    const ev = [[0.05, 'keydown', 'Space']];
    let t = 0.15;
    for (let round = 0; round < 3; round++) {
      for (const c of ['KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP']) {
        ev.push(...pressEv(t, c)); t += 0.07;
      }
    }
    ev.push([t + 0.15, 'keyup', 'Space']);
    return ev;
  } },
  { name: 'slot-exhaustion', ev: () => {
    // 34 Y presses on ONE held note: each press toggles the additive voice
    // and re-aims the level — 34 slots cross the 32-slot segment and force a
    // chain GROW (the engine's only live edge swap) mid-note. Chromium
    // renders the swap atomically; a click here means the grow splice itself
    // is audible.
    const ev = [[0.05, 'keydown', 'Space']];
    let t = 0.15;
    for (let i = 0; i < 34; i++) {
      ev.push([t, 'keydown', 'KeyY']);
      t += 0.07;
    }
    ev.push([t + 0.2, 'keyup', 'Space']);
    return ev;
  } },
  { name: 'pivot-spam', ev: () => {
    const ev = [...pressEv(0.03, 'KeyN'), ...pressEv(0.06, 'KeyH')];
    ev.push(...spamEv(rng(7), 12));
    ev.push(...pressEv(3.2, 'KeyN'));
    return ev;
  } },
  { name: 'octave-jerk', ev: () => {
    const ev = [[0.05, 'keydown', 'Space']];
    for (let i = 0; i < 10; i++) ev.push(...pressEv(0.15 + i * 0.06, i % 2 ? 'Comma' : 'Period'));
    ev.push([0.85, 'keyup', 'Space']);
    return ev;
  } },
  { name: 'hum-plus-spam', ev: () => {
    const ev = [...pressEv(0.03, 'KeyM')]; // tonic hum on
    ev.push(...spamEv(rng(99), 10, 0.3));
    ev.push(...pressEv(2.4, 'KeyM'));
    return ev;
  } },
];

async function runScene(browser, scene) {
  const page = await openPage(browser);
  const ev = scene.ev();
  const r = await page.evaluate((e) => window.__press(e), ev);
  await page.close();
  const ok = r.hits.length === 0 && r.clips === 0;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${scene.name.padEnd(16)} ${r.ms}ms virtual, ` +
    `peak ${r.peak}, clips ${r.clips}, clicks ${r.hits.length}`);
  for (const h of r.hits.slice(0, 8)) {
    console.log(`    click @ ${h.ms}ms d=${h.d} n=${h.sample} (q=${h.sample % 128})`);
    console.log(`      fine: ${h.fine}`);
    const near = ev.filter(([t]) => t * 1000 >= h.ms - 30 && t * 1000 <= h.ms + 15)
      .map(([t, ty, c]) => `${(t * 1000).toFixed(1)}ms ${ty} ${c}`);
    if (near.length) console.log(`      events near: ${near.join(' | ')}`);
  }
  return ok;
}

const browser = await chromium.launch();
let pass = false;
{
  const page = await openPage(browser);
  const c = await page.evaluate(() => window.__controls());
  await page.close();
  const okSine = c.sine.hits.length === 0;
  const okBlast = c.blast.hits.length >= 1;
  const okBoundary = c.boundaryPin.hits.length >= 1;
  const okStage = c.stageForm.hits.length === 0 && c.stageForm.levelRatio > 0.5;
  console.log(`[${okSine ? 'PASS' : 'FAIL'}] control:sine  (0 hits; got ${c.sine.hits.length}, peak ${c.sine.peak})`);
  console.log(`[${okBlast ? 'PASS' : 'FAIL'}] control:blast (>=1 hit; got ${c.blast.hits.length}` +
    (c.blast.hits[0] ? `, first d=${c.blast.hits[0].d} @ ${c.blast.hits[0].ms}ms` : '') + ')');
  console.log(`[${okBoundary ? 'PASS' : 'FAIL'}] control:boundary-pin (>=1 hit; got ${c.boundaryPin.hits.length}` +
    (c.boundaryPin.hits[0] ? `, first d=${c.boundaryPin.hits[0].d} @ ${c.boundaryPin.hits[0].ms}ms q=${c.boundaryPin.hits[0].sample % 128}` : '') +
    ') — cancel+pin at a block start must show the artifact (the anti-pattern)');
  console.log(`[${okStage ? 'PASS' : 'FAIL'}] control:stage-form (0 hits; got ${c.stageForm.hits.length})` +
    ' — the engine stage pattern must be clean');
  pass = okSine && okBlast && okBoundary && okStage;
  if (!pass) console.log('HARNESS UNCERTIFIED — every result below is meaningless.');
}
for (const s of SCENES) {
  if (filter.length && !filter.some((f) => s.name.includes(f))) continue;
  pass = (await runScene(browser, s)) && pass;
}
await browser.close();
server.close();
console.log(pass ? 'ALL GREEN — no discontinuity in the rendered output' : 'FAILURES — see clicks above');
process.exit(pass ? 0 : 1);
