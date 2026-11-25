// pop-probe.js v8.6 — DEV ONLY: clipping + click detector on the output bus.
//
// Load after app.js and BEFORE the first note, from the console:
//   var s = document.createElement('script');
//   s.src = 'pop-probe.js?nocache=' + Date.now(); document.head.appendChild(s);
//   ^ the cache-buster is NOT optional: a plain src served stale code on a
//   live debug session. Verify the box says "pop-probe v8.6" and the attach
//   line says "v8.6 attached" — anything older is cached and its counts are
//   its own noise.
//   (if you already played sound on this page load, reload the page first —
//   an existing connection to the speakers cannot be retroactively tapped)
//
// v5 adds a PARAM-EVENT LEDGER: every GainNode the app creates gets its
// gain's automation methods wrapped, so each scheduled change is recorded
// (which gain, which method, value, target time, wall time of the call).
// Each corroborated CLICK now prints the ledger rows around it — the
// rendered waveform next to the exact event list that produced it names the
// offender outright (e.g. a click BEFORE a ramp's start time = the ramp
// committed late / scheduled in the past).
//
// v4's overlapping double reads stay: the analyser window is polled at half
// its length, so consecutive reads share half their samples. A discontinuity
// in the actual output exists in the samples themselves — both overlapping
// reads copy it, at the same back-projected ctx time. A race inside the
// analyser's ring copy corrupts ONE read only: CLICK = corroborated twice
// (real, audible); blip? = single read (probe artifact). Coverage is fully
// contiguous.
//
// v1 routed the speakers' signal THROUGH a ScriptProcessor — main-thread JS
// sitting in the audio path, refreshing the DOM on every buffer. It measured
// pops while CAUSING pops: an underrun glitches downstream of its own input,
// so it couldn't even count its own worst hits. v2 never intercepts: it taps
// the signal in PARALLEL with an AnalyserNode (a leaf — the graph feeding the
// speakers is untouched) and inspects ~0.7s windows on a timer. Clicks get
// back-projected onto the ctx clock so they still line up with the logged
// engine calls (startTone/stopTone/stopVoicesAt...). Polling window == poll
// interval, so coverage is near-contiguous; the odd rare click may slip
// through a timer gap. Readout box bottom-right; __popProbe.summary() prints
// only the triage set (status, CLICKs, fallback splices + context);
// __popProbe.report() prints the whole timeline as a table.
//
// v3 forensics: every gain-automation cancel logs its re-pin value
// (cancelHold), releases log level + fade, voicing diffs log voice counts,
// disconnects log their key — so a CLICK line can be matched to the exact
// fade responsible. Each CLICK also carries a raw slice of the waveform
// around the jump: flat levels either side = gain step; one missing beat =
// dropped sample; the wave restarting mid-swing = a node re-entering.
(function () {
  if (window.__popProbe) return;
  const probe = { events: [], gainEvents: [], clips: 0, clicks: 0, blips: 0, peak: 0, polls: 0, ctx: null };
  window.__popProbe = probe;

  function log(kind, msg) {
    const t = probe.ctx ? probe.ctx.currentTime : 0;
    probe.events.push({ t: +t.toFixed(3), kind, msg, keep: msg.indexOf('FALLBACK-SPLICE') !== -1 });
    trim();
  }
  function trim() {
    if (probe.events.length <= 600) return;
    // drop the 100 OLDEST lines — but flagged ones (CLICK / blip? /
    // FALLBACK-SPLICE, marked keep) are NEVER evicted: summary() must be
    // able to explain every counted click no matter how much spam follows
    const drop = [];
    for (let i = 0; i < probe.events.length && drop.length < 100; i++) {
      if (!probe.events[i].keep) drop.push(i);
    }
    for (let i = drop.length - 1; i >= 0; i--) probe.events.splice(drop[i], 1);
  }
  probe._trim = trim; // exposed for tests (smoke: flagged lines survive spam)
  probe.report = () => {
    console.table(probe.events.map((e) => ({ t: e.t, kind: e.kind, msg: e.msg.slice(0, 48) })));
    // full lines, uncut (console.table clips cells — the slices and the
    // gain ledger are the point; read them here)
    probe.events.forEach((e, i) => console.log(`#${i} [${e.t}] ${e.kind} ${e.msg}`));
  };

  // Triage print for pasting to the developer — everything needed, nothing else:
  //   status line (version/attach + counts), every CLICK / blip? /
  //   FALLBACK-SPLICE line in full, and ±6 engine lines of context around each
  //   (skipped entirely on a clean run).
  probe.summary = () => {
    const ev = probe.events;
    console.log(`pop-probe v8.6 ${probe.ctx ? 'attached' : 'NOT ATTACHED — attach probe BEFORE playing'} · ` +
      `engine ${typeof window.growChain !== 'function' ? 'OLD-CACHED (hard-reload!)'
        : typeof window.qa !== 'function' ? 'GROW-but-NO-ALIGN (cached app.js!)'
        : (window.__pdrRev || 0) >= 6 ? 'grow+align+bornSilent+warm+chiffKill'
        : (window.__pdrRev || 0) >= 5 ? 'grow+align+bornSilent+warm'
        : 'PRE-WARM (hard-reload app.js!)'} · ` +
      `peak ${probe.peak.toFixed(2)} · clips ${probe.clips} · clicks ${probe.clicks} · ` +
      `blips ${probe.blips} · events ${ev.length} · freq ${window.freqGlide === false ? 'SNAP(experiment)' : 'glide'}` +
      ` · chiff ${window.__pdrChiff === 'killed' ? (window.chiffOn === true ? 'REVIVED(experiment)' : 'KILLED')
        : (window.chiffOff === true ? 'OFF(experiment, old build)' : 'ON(old build — hard-reload!)')}`);
    const flagged = [];
    ev.forEach((e, i) => {
      if (e.kind === 'CLICK' || e.kind === 'blip?' || e.msg.indexOf('FALLBACK-SPLICE') !== -1) flagged.push(i);
    });
    if (!flagged.length) {
      if (probe.clicks || probe.blips) {
        // never cry "clean" over a nonzero counter: the lines must have been
        // evicted by the OLD trim (pre-v8.5 cached copy) — say so loudly
        console.log(`WARNING: counters say ${probe.clicks} click(s) / ${probe.blips} blip(s) ` +
          'but no flagged lines remain in the log — stale probe copy (old trim evicted ' +
          'them): hard-reload, re-attach, confirm the box says v8.6, play again');
      } else {
        console.log('no CLICKs, no blips, no fallback splices — clean run');
      }
      return;
    }
    const show = new Set();
    for (const i of flagged) {
      for (let j = Math.max(0, i - 6); j <= Math.min(ev.length - 1, i + 2); j++) show.add(j);
    }
    let prev = -2;
    ev.forEach((e, i) => {
      if (!show.has(i)) return;
      if (i !== prev + 1) console.log('   …');
      prev = i;
      console.log(`#${i} [${e.t}] ${e.kind} ${e.msg}`);
    });
  };

  // --- live readout (main thread — written from the poll timer, never in a
  // per-buffer audio callback) ---
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:9999;' +
    'font:10px/1.5 ui-monospace,SFMono-Regular,monospace;color:#8fe;' +
    'background:rgba(0,0,0,.8);padding:4px 8px;border-radius:6px;' +
    'pointer-events:none;white-space:pre';
  box.textContent = 'pop-probe v8.6 armed — play a note to attach';
  document.body.appendChild(box);
  function refresh() {
    const last = probe.events.length ? probe.events[probe.events.length - 1] : null;
    box.textContent =
      `pop-probe v8.6 ${probe.ctx ? '' : '(NOT ATTACHED) '}peak ${probe.peak.toFixed(2)} · ` +
      `clips ${probe.clips} · clicks ${probe.clicks} · blips ${probe.blips} · ` +
      `freq ${window.freqGlide === false ? 'SNAP' : 'glide'}\n` +
      `last ${last ? last.kind + ' "' + last.msg + '" ' + last.t + 's' : 'idle'}`;
  }

  // --- gain-node spy: record every automation call the app schedules on any
  // GainNode's .gain, so a CLICK can be matched to the exact event list that
  // produced it. Wraps GainNode gain methods once, at AudioContext.prototype
  // .createGain time; cheap (a push per scheduled event, not per sample). ---
  (function installGainSpy() {
    if (typeof AudioContext === 'undefined') return;
    const origCreate = AudioContext.prototype.createGain;
    let gid = 0;
    AudioContext.prototype.createGain = function () {
      const node = origCreate.call(this);
      const id = ++gid;
      const p = node.gain;
      const ctx = this;
      const wrap = (name) => {
        const m = p[name];
        if (typeof m !== 'function') return;
        p[name] = function (value, when) {
          const wall = ctx.currentTime;
          // setTargetAtTime/others pass timeConstant instead of `when`
          probe.gainEvents.push({
            g: id, fn: name,
            val: +(+value).toFixed(4),
            at: when === undefined ? null : +(+when).toFixed(4),
            wall: +wall.toFixed(4),
          });
          if (probe.gainEvents.length > 800) probe.gainEvents.splice(0, 200);
          return m.call(this, value, when);
        };
      };
      ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
        'cancelScheduledValues', 'setTargetAtTime'].forEach(wrap);
      return node;
    };
  })();

  // lines describing gain automation near a click, newest last
  probe.gainLedger = (t, win) => probe.gainEvents
    .filter((e) => Math.abs(e.at - t) <= win || Math.abs(e.wall - t) <= win)
    .map((e) => `g${e.g}.${e.fn.replace('ToTime', 'T').replace('ValueAtTime', 'V')}` +
      `→${e.at === null ? '?' : e.at}(v=${e.val} t=${e.wall})`)
    .join('  ');

  // --- engine entry points (classic script => global declarations) ---
  for (const name of ['startTone', 'stopTone', 'startHum', 'stopHum']) {
    if (typeof window[name] !== 'function') continue;
    const orig = window[name];
    window[name] = function () {
      log('engine', name);
      if (!probe.ctx) {
        setTimeout(() => {
          if (probe.ctx) return;
          box.textContent =
            'pop-probe COULD NOT ATTACH: the audio graph existed before the\n' +
            'probe loaded. Reload the page, paste the probe line FIRST,\n' +
            'then play.';
        }, 400);
      }
      return orig.apply(this, arguments);
    };
  }
  if (typeof window.stopVoicesAt === 'function') {
    const orig = window.stopVoicesAt;
    window.stopVoicesAt = function (voiceList, when, extraNodes) {
      const now = probe.ctx ? probe.ctx.currentTime : when;
      log('engine', `stopVoicesAt n=${voiceList.length} in ${Math.max(0, when - now).toFixed(3)}s` +
        (extraNodes ? ' +' + extraNodes.length + 'cleanup-nodes' : ''));
      return orig.apply(this, arguments);
    };
  }

  // v8.5: slot chains GROW instead of falling back to edge splices; the only
  // live edge swap left in the engine is the one-per-32-transitions GROW (a
  // task-local swap, logged — a CLICK aligned with a GROW line is expected
  // WebKit behaviour, everything else is news). insertStage is gone from the
  // engine; its old tripwire hook below stays as a regression detector.
  if (typeof window.growChain === 'function') {
    const orig = window.growChain;
    window.growChain = function (gr) {
      orig.call(this, gr);
      log('engine', 'GROW chain -> ' + gr.chain.length + ' slots');
    };
  }
  if (typeof window.fireSlot === 'function') {
    const orig = window.fireSlot;
    window.fireSlot = function (group, now, mult, dur) {
      const ok = orig.apply(this, arguments);
      if (group) {
        log('engine', `fireSlot #${group.slot - 1} x${(+mult).toFixed(4)} in ` +
          `${(+dur).toFixed(3)}s lvl=${group.gain.gain.value.toFixed(4)}${ok ? '' : ' FAILED'}`);
      }
      return ok;
    };
  }
  if (typeof window.insertStage === 'function') {
    const orig = window.insertStage;
    window.insertStage = function (srcNode, destHint) {
      const stage = orig.apply(this, arguments);
      log('engine', `FALLBACK-SPLICE @${audioCtx.currentTime.toFixed(4)} ` +
        `src=${srcNode.gain.value.toFixed(4)} — webkit may eat a quantum`);
      return stage;
    };
  }
  if (typeof window.releaseVoices === 'function') {
    const orig = window.releaseVoices;
    window.releaseVoices = function (voiceList, fadeTime, gain) {
      log('engine', `releaseVoices n=${voiceList.length} fade=${fadeTime}s lvl=${gain.gain.value.toFixed(4)}`);
      return orig.apply(this, arguments);
    };
  }
  if (typeof window.updateFrequencyIfSounding === 'function') {
    const orig = window.updateFrequencyIfSounding;
    window.updateFrequencyIfSounding = function (preserveLevel) {
      log('engine', `updateFreq sounding=${typeof isSounding !== 'undefined' ? isSounding : '?'} ` +
        `n=${typeof voices !== 'undefined' ? voices.length : '?'} keepLevel=${preserveLevel === true}`);
      return orig.apply(this, arguments);
    };
  }
  if (typeof window.destroyVoice === 'function') {
    const orig = window.destroyVoice;
    window.destroyVoice = function (v) {
      log('engine', `destroyVoice ${v.key}`);
      return orig.apply(this, arguments);
    };
  }

  // --- parallel tap: branch anything that connects to the speakers into an
  // AnalyserNode, leaving the real connection untouched ---
  function buildTap(ctx) {
    if (probe.ctx) return;
    probe.ctx = ctx;
    const an = ctx.createAnalyser();
    an.fftSize = 16384;            // ~340 ms window at 48k
    an.smoothingTimeConstant = 0;  // irrelevant for time-domain reads, explicit anyway
    probe.an = an;
    const buf = new Float32Array(an.fftSize);
    const rate = ctx.sampleRate;
    const WINDOW_MS = (an.fftSize / rate) * 1000;
    let slopeMax = 0; // leaky running max of |delta|: what this material normally does
    const LEAK = 0.9990; // ~30ms memory at 48kHz
    // Overlap: poll at half the window, so every sample is read by two
    // separate getFloatTimeDomainData calls minutes apart in JS time but the
    // same samples in audio time. A glitch in the OUTPUT exists in both
    // copies; a glitch manufactured by one racy ring-copy exists in one.
    // ctx.currentTime quantizes to render blocks, so the two back-projected
    // times can disagree by a block — hence the 12ms corroboration window.
    const CORROBATE_S = 0.012;
    let pending = []; // {t, d, age} detections awaiting their second read

    function poll() {
      probe.polls++;
      const now = ctx.currentTime;
      an.getFloatTimeDomainData(buf);
      let peak = 0;
      const found = [];
      for (let i = 1; i < buf.length; i++) {
        const a = Math.abs(buf[i]);
        // every sample is read twice (overlap) — only count clips in this
        // read's NEW half, the stretch of time the previous read never saw
        if (a > 0.995 && i > buf.length / 2) probe.clips++;
        if (a > peak) peak = a;
        const d = Math.abs(buf[i] - buf[i - 1]);
        const prev = slopeMax * LEAK;
        // click: a jump no sine in this mix could make (needs a ~4x slope break)
        if (d > 0.02 && d > 4 * prev) {
          // back-projected to the ctx clock; the sample's truth time is fixed
          // even though which buffer index holds it drifts between reads
          found.push({ i, d, a, t: now - (buf.length - i) / rate });
          if (found.length >= 40) break; // per-window cap; counting continues via slope
        }
        slopeMax = Math.max(d, prev);
      }
      for (const f of found) {
        // Only the NEW half creates candidates: its twin region in the next
        // read (the next read's OLD half) must echo it. Detecting in both
        // halves made every event a candidate twice, which double-fired
        // CLICKs and false-matched different events 12ms apart.
        const k = pending.findIndex((p) => Math.abs(p.t - f.t) < CORROBATE_S);
        if (k !== -1) {
          const p = pending.splice(k, 1)[0];
          // a dropped sample is TWO edges (out and back) ~1 sample apart:
          // the second edge must not report as a second click
          pending = pending.filter((q) => Math.abs(q.t - p.t) > 0.002);
          probe.clicks++; // echoed by the next read at the same audio time
          const t = (p.t + f.t) / 2;
          // wide slice, every 4th sample: ±1ms covers a partial's period, so
          // the waveform's SHAPE around the jump is readable, not just its
          // slope — a step between two smooth branches vs a notch vs noise
          const s = [];
          for (let j = Math.max(0, f.i - 48); j < Math.min(buf.length, f.i + 49); j += 4) {
            s.push((buf[j] * 1000 | 0) / 1000);
          }
          probe.events.push({
            t: +t.toFixed(4),
            kind: 'CLICK', keep: true,
            msg: `Δ=${Math.max(p.d, f.d).toFixed(3)}` + (f.a > 0.995 ? ' (full-scale!)' : '') +
              ` ×2 reads (Δ ${p.d.toFixed(3)}/${f.d.toFixed(3)})` +
              (Math.max(p.d, f.d) > 3 * Math.min(p.d, f.d) ? ' [reads disagree — suspect]' : '') +
              ` [${s.join(' ')}] | ` + probe.gainLedger(t, 0.15),
          });
        } else if (f.i > buf.length / 2) {
          pending.push({ t: f.t, d: f.d, age: 0 });
        }
      }
      pending.forEach((p) => p.age++);
      for (const p of pending) {
        if (p.age > 1) { // its overlap twin saw nothing at this time
          probe.blips++;
          probe.events.push({
            t: +p.t.toFixed(4), kind: 'blip?', keep: true,
            msg: `Δ=${p.d.toFixed(3)} single read only — analyser read-race, not audible`,
          });
        }
      }
      pending = pending.filter((p) => p.age <= 1);
      if (peak > probe.peak) probe.peak = peak;
      trim();
      refresh();
    }
    probe.timer = setInterval(poll, WINDOW_MS / 2); // 50% overlap, no coverage gaps
    log('probe', 'v8.6 attached — parallel tap, new-half double reads, gain-ledger armed; ' +
      'CLICK = echoed by next read (real), blip? = one read (probe race)');
  }

  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest) {
    if (dest instanceof AudioDestinationNode) {
      buildTap(dest.context); // captures ctx whenever the real graph wires up
      if (probe.an) {
        try { origConnect.call(this, probe.an); } catch (e) {} // branch a copy, don't reroute
      }
    }
    return origConnect.apply(this, arguments); // speakers get the original, unbroken chain
  };
})();
