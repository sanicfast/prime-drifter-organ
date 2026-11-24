// pop-probe.js — DEV ONLY: clipping + click detector on the output bus.
//
// Loads after app.js but does nothing until the first note (the AudioContext
// is created lazily), so plain script tag or console paste both work:
//   var s = document.createElement('script');
//   s.src = 'pop-probe.js'; document.head.appendChild(s);
//   (do this before the first sound, after a page load)
//
// It reroutes whatever reaches the speakers through a detector that counts
// full-scale samples and flags CLICKS: sample jumps far steeper than the
// local waveform slope can explain. Every event gets a ctx-time timestamp,
// and engine calls (startTone/stopTone/stopVoicesAt...) are logged too, so
// a pop can be matched to the exact scheduling moment that caused it.
// Live counts sit in a small box bottom-right; __popProbe.report() prints
// the timeline as a table.
(function () {
  if (window.__popProbe) return;
  const probe = { events: [], clips: 0, clicks: 0, peak: 0, ctx: null };
  window.__popProbe = probe;

  function log(kind, msg) {
    const t = probe.ctx ? probe.ctx.currentTime : 0;
    probe.events.push({ t: +t.toFixed(3), kind, msg });
    if (probe.events.length > 600) probe.events.splice(0, 100);
  }
  probe.report = () => console.table(probe.events);

  // --- wrap engine entry points (classic script => global declarations) ---
  for (const name of ['startTone', 'stopTone', 'startHum', 'stopHum']) {
    if (typeof window[name] !== 'function') continue;
    const orig = window[name];
    window[name] = function () { log('engine', name); return orig.apply(this, arguments); };
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

  // --- live readout ---
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:9999;' +
    'font:10px/1.5 ui-monospace,SFMono-Regular,monospace;color:#8fe;' +
    'background:rgba(0,0,0,.8);padding:4px 8px;border-radius:6px;' +
    'pointer-events:none;white-space:pre';
  box.textContent = 'pop-probe armed — waiting for first note';
  document.body.appendChild(box);
  function refresh() {
    const last = probe.events.length ? probe.events[probe.events.length - 1] : null;
    box.textContent =
      `pop-probe  peak ${probe.peak.toFixed(2)} · clips ${probe.clips} · clicks ${probe.clicks}\n` +
      `last ${last ? last.kind + ' ' + last.t + 's' : 'idle'}`;
  }

  // --- output tap ---
  function attach(ctx) {
    if (probe.ctx) return;
    probe.ctx = ctx;
    const sp = ctx.createScriptProcessor(2048, 1, 1);
    let slopeMax = 0; // leaky running max of |delta|: what this material "normally" does
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
    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest) {
      if (dest === ctx.destination) { // whatever feeds the speakers goes through us
        origConnect.call(this, sp);
        return origConnect.call(sp, ctx.destination);
      }
      return origConnect.apply(this, arguments);
    };
    refresh();
  }

  // --- capture the lazily-created AudioContext ---
  const OrigCtx = window.AudioContext || window.webkitAudioContext;
  window.AudioContext = class extends OrigCtx {
    constructor() { super(...arguments); queueMicrotask(() => attach(this)); }
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
})();
