// pop-probe.js — DEV ONLY: clipping + click detector on the output bus.
//
// Load after app.js and BEFORE the first note, plain script tag or console:
//   var s = document.createElement('script');
//   s.src = 'pop-probe.js'; document.head.appendChild(s);
//   (if you already played sound on this page load, reload the page first —
//   an existing connection to the speakers cannot be retroactively tapped)
//
// It reroutes whatever reaches the speakers through a detector that counts
// full-scale samples and flags CLICKS: sample jumps far steeper than the
// local waveform slope can explain. Every event gets a timestamp, and
// engine calls (startTone/stopTone/stopVoicesAt...) are logged too, so a
// pop can be matched to the exact scheduling moment that caused it.
// Live counts sit in a small box bottom-right; __popProbe.report() prints
// the timeline as a table.
(function () {
  if (window.__popProbe) return;
  const probe = { events: [], clips: 0, clicks: 0, peak: 0, ctx: null };
  window.__popProbe = probe;
  let noteSeenBeforeTap = false;

  function log(kind, msg) {
    const t = probe.ctx ? probe.ctx.currentTime : 0;
    probe.events.push({ t: +t.toFixed(3), kind, msg });
    if (probe.events.length > 600) probe.events.splice(0, 100);
    refresh();
  }
  probe.report = () => console.table(probe.events);

  // --- live readout ---
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:9999;' +
    'font:10px/1.5 ui-monospace,SFMono-Regular,monospace;color:#8fe;' +
    'background:rgba(0,0,0,.8);padding:4px 8px;border-radius:6px;' +
    'pointer-events:none;white-space:pre';
  box.textContent = 'pop-probe armed — play a note to attach';
  document.body.appendChild(box);
  function refresh() {
    const last = probe.events.length ? probe.events[probe.events.length - 1] : null;
    box.textContent =
      `pop-probe ${probe.ctx ? '' : '(NOT ATTACHED) '}peak ${probe.peak.toFixed(2)} · ` +
      `clips ${probe.clips} · clicks ${probe.clicks}\n` +
      `last ${last ? last.kind + ' "' + last.msg + '" ' + last.t + 's' : 'idle'}`;
  }

  // --- engine entry points (classic script => global declarations) ---
  for (const name of ['startTone', 'stopTone', 'startHum', 'stopHum']) {
    if (typeof window[name] !== 'function') continue;
    const orig = window[name];
    window[name] = function () {
      log('engine', name);
      if (!probe.ctx) {
        noteSeenBeforeTap = true;
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
        (extraNodes ? ' [note/trim]' : ' [dying voices]'));
      return orig.apply(this, arguments);
    };
  }

  // --- output tap: hook EVERY connect-to-speakers, whenever it happens ---
  function buildTap(ctx) {
    if (probe.ctx) return;
    probe.ctx = ctx;
    const sp = ctx.createScriptProcessor(2048, 1, 1);
    let slopeMax = 0; // leaky running max of |delta|: what this material normally does
    sp.onaudioprocess = (e) => {
      const x = e.inputBuffer.getChannelData(0);
      e.outputBuffer.getChannelData(0).set(x); // pass through untouched
      const LEAK = 0.9990; // ~30ms memory at 48kHz
      let peak = 0;
      for (let i = 1; i < x.length; i++) {
        const a = Math.abs(x[i]);
        if (a > 0.995) probe.clips++;
        if (a > peak) peak = a;
        const d = Math.abs(x[i] - x[i - 1]);
        const prev = slopeMax * LEAK;
        // click: a jump no sine in this mix could make (needs a ~4x slope break)
        if (d > 0.02 && d > 4 * prev) {
          probe.clicks++;
          log('CLICK', `Δ=${d.toFixed(3)} at t=${(e.playbackTime + i / ctx.sampleRate).toFixed(4)}` +
            (a > 0.995 ? ' (full-scale!)' : ''));
        }
        slopeMax = Math.max(d, prev);
      }
      if (peak > probe.peak) probe.peak = peak;
      refresh();
    };
    probe.sp = sp;
    log('probe', 'attached to output');
  }
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest) {
    if (dest instanceof AudioDestinationNode) {
      buildTap(dest.context); // captures ctx whenever the real graph wires up
      if (probe.sp) {
        origConnect.call(this, probe.sp);
        return origConnect.call(probe.sp, dest);
      }
    }
    return origConnect.apply(this, arguments);
  };
})();
