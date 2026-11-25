// Prime Drifter Organ — Main app

// === App State ===

const ROOT_HZ_LOW = 55;   // slider bounds for the initial root
const ROOT_HZ_HIGH = 880;
let baseHz = 264;         // where vector [0,0,0,0] lives (default C4 = 264 Hz) — also the hum's pitch
const VOLUME = 0.3;
let masterVolume = 1;      // output level — a setting like the envelope: never in the undo stack
const HUM_VOLUME = 0.05;
const HUM_FADE = 0.4;
const VOICE_FADE = 0.06; // crossfade time for voices joining/leaving a held chord
const TAIL_TRIM = 0.05;  // linear fade used to trim over-budget tails
const TAIL_BUDGET = 0.55; // summed note-gain ceiling before the mix strains
// New-note envelopes start this far ahead of ctx.currentTime: the render
// thread runs ahead of what the main thread can observe (>=1 block, more
// under load); anchoring an attack in that blind past makes it commit
// midway through its own ramp — a phantom step that pop-probe caught as
// corroborated full-voice clicks exactly one block after startTone.
const LOOKAHEAD = 0.012;

let body = 0.6; // timbre: weight of the upper harmonic stack (0 = airy sine only)

// Upper partials and their mix at full body. These multipliers are the
// collision points where tuning purity becomes audible: e.g. root ×5 and a
// true 5:4 third's ×4 both land on 5f — with these partials present, a pure
// third interferes with itself into stillness, and 81:64 buzzes instead.
const PARTIAL_MIX = [
  { mult: 3, mix: 0.12 },
  { mult: 4, mix: 0.07 },
  { mult: 5, mix: 0.05 },
  { mult: 7, mix: 0.04 },
];

let audioCtx = null;
let masterGain = null; // mix bus + master volume — note envelopes never touch it
let noiseBuffer = null;
let voices = []; // active voice group (array of voice objects)
let noteGain = null; // gain node of the current note — its envelope is its own
let noteGroups = []; // {gain, voices} of current + still-ringing notes (tail budget)
let releasing = new Set(); // voices currently fading; the overtone view draws them dim
let isSounding = false;
let currentVector = new PrimeVector(0, 0, 0, 0);
let lastMove = null;
let activeChord = null; // key code of active chord preset, or null
let activeAdditives = new Set(); // set of key codes for active additive ratios
let humNodes = null; // tonic hum voice { oscs, gains }, or null when off
let pivotMode = false; // step pivot chord mode: chords step the root on note-off
let holdMode = false; // hold/perform mode: voicing keys are momentary
let heldChordStack = []; // chord keys physically down, bottom-first (hold mode)
let invertedMode = false; // invert mode: chords hang below the root

// === Undo / Redo ===

let undoStack = []; // array of {delta, description}
let redoStack = []; // array of {delta, description}

// === Envelope Parameters ===

let envelope = {
  attack: 0.05,
  decay: 0.1,
  sustain: 0.7,
  release: 0.3
};

// === DOM Elements ===

const hzDisplay = document.getElementById('hz-display');
const noteDisplay = document.getElementById('note-display');
const stateDisplay = document.getElementById('state-display');
const moveDisplay = document.getElementById('move-display');
const chordDisplay = document.getElementById('chord-display');
const humIndicator = document.getElementById('hum-indicator');
const pivotIndicator = document.getElementById('pivot-indicator');
const holdIndicator = document.getElementById('hold-indicator');
const invertIndicator = document.getElementById('invert-indicator');
const vecEls = [
  document.getElementById('vec-0'),
  document.getElementById('vec-1'),
  document.getElementById('vec-2'),
  document.getElementById('vec-3'),
];

// === Envelope Sliders ===

function setupSliders() {
  const sliders = [
    { id: 'env-a', key: 'attack', suffix: 's', decimals: 3 },
    { id: 'env-d', key: 'decay', suffix: 's', decimals: 2 },
    { id: 'env-s', key: 'sustain', suffix: '', decimals: 2 },
    { id: 'env-r', key: 'release', suffix: 's', decimals: 2 },
  ];

  for (const s of sliders) {
    const input = document.getElementById(s.id);
    const label = document.getElementById(s.id + '-val');
    input.addEventListener('input', () => {
      envelope[s.key] = parseFloat(input.value);
      label.textContent = parseFloat(input.value).toFixed(s.decimals) + s.suffix;
    });
  }
}

// === Initial Root Control ===

// Log-scale slider: 55..880 Hz, with 220 at center
function rootHzFromSlider(t) {
  return ROOT_HZ_LOW * Math.pow(2, t * Math.log2(ROOT_HZ_HIGH / ROOT_HZ_LOW));
}

function sliderTForHz(hz) {
  const t = Math.log2(hz / ROOT_HZ_LOW) / Math.log2(ROOT_HZ_HIGH / ROOT_HZ_LOW);
  return Math.min(1, Math.max(0, t)); // display clamps; baseHz itself may exceed the slider
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']; // index = midi % 12

// Nearest equal-tempered note — a courtesy label (≈), not a promise
function approxNoteName(hz) {
  const midi = 69 + Math.round(12 * Math.log2(hz / 440));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${name}${Math.floor(midi / 12) - 1}`;
}

let rootSliderEl, rootLabelEl;

// The instrument's anchor, set from anywhere: slider, score `sethz`, ...
// A setting, not a move: no undo entry, same as dragging the slider.
function setBaseHz(hz) {
  baseHz = Math.min(8000, Math.max(1, hz)); // sanity guard; folding handles the audible rest
  rootSliderEl.value = sliderTForHz(baseHz);
  rootLabelEl.textContent = `${baseHz.toFixed(1)} Hz ≈ ${approxNoteName(baseHz)}`;
  updateDisplay();
  updateFrequencyIfSounding(); // glides a held chord
  retuneHum();
}

function setupRootControl() {
  rootSliderEl = document.getElementById('base-hz');
  rootLabelEl = document.getElementById('base-hz-val');

  rootSliderEl.addEventListener('input', () => {
    setBaseHz(rootHzFromSlider(parseFloat(rootSliderEl.value)));
    recordBaseHz(false);
  });
  setBaseHz(rootHzFromSlider(parseFloat(rootSliderEl.value)));
}

// === Audio ===

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = masterVolume; // the volume slider's bus; envelopes never touch it

  // Gentle safety limiter: overlapping tails + hum + a full harmonic stack
  // can sum past 1.0 on fast playing; soft-clip that instead of hard-crunching.
  const limiter = audioCtx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 8;
  limiter.ratio.value = 4;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.18;
  masterGain.connect(limiter);
  limiter.connect(audioCtx.destination);

  const duration = 2;
  const bufferSize = audioCtx.sampleRate * duration;
  noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
}

function getAudibleFreq() {
  return foldToAudible(currentVector.toFrequency(baseHz));
}

// Adds the upper harmonic stack (×3 ×4 ×5 ×7) to a destination voice chain
function addHarmonics(freq, dest, startAt) {
  const partials = [];
  // WARM RULE (see makeChainSegment): body changes later fire setTarget on
  // these gains while the partial is at full amplitude — cache-cold under
  // signal again. Touch each once now; the partials' oscillators only start
  // at startAt, so nothing can flow while the cache materializes.
  const warmAt = warmBlock();
  for (const { mult, mix } of PARTIAL_MIX) {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    const gain = audioCtx.createGain();
    gain.gain.value = mix * body;
    gain.gain.setValueAtTime(mix * body, warmAt);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(startAt);
    partials.push({ osc, gain, mult, mix });
  }
  return partials;
}

// Render-quantum alignment for AudioParam event times. Safari field capture
// (v8.2): every CLICK (15/15) landed within one block of a segment junction
// whose event time fell mid-block in a live param's timeline — the Δ equalled
// the param's live value and the waveform carried a one-sample slot or step
// there (e.g. CLICK @61.902 == chiff lin-end event @61.902). Params whose
// events ride the block-aligned `now` (slots, fin, fout, note envelopes at
// their birth) produced zero flags across every log. So: NO event boundary
// mid-block. Chromium renders both ways identically; Safari only caches the
// grid cleanly. Ceil (never floor) keeps every event at-or-after `now` even
// when the clock advanced during voice creation.
function Q() { return 128 / audioCtx.sampleRate; } // one render quantum

function qa(t) {
  // -1e-9: a clock value with float drift one ulp past a boundary (or a sim
  // clock at 1.5400000000000002) must land ON that boundary, not one block
  // late.
  return Math.ceil(t / Q() - 1e-9) * Q();
}

// WARM RULE (see makeChainSegment) pin time: the START of the PREVIOUS render
// block. The warm pin must be strictly older than every real event the engine
// ever schedules on the param — those all anchor at >= currentTime — so it can
// never out-order or clobber an envelope. A NEXT-block pin did exactly that:
// qa(now+Q) landed after the same-task raw-currentTime fade-in and punched the
// whole attack out of the timeline (click-test caught it as a level jump equal
// to the voice level). Being block-aligned and value-equal, a past pin is a
// provably no-op timeline segment — silent x guess = silent — yet it is still
// a timeline segment, which is what materializes Safari's cold cache before
// the param's first real event ever fires.
function warmBlock() {
  return qa(Math.max(audioCtx.currentTime - Q(), 0));
}

function createVoice(freq, key, dest) {
  const now = audioCtx.currentTime;
  const nodes = [];

  // Decorrelated start: oscillators would all begin at phase zero and the
  // noise sources would all read the same buffer offset, so fast notes on
  // the same pitch add PHASE-COHERENTLY — stacked spam hits the limiter far
  // sooner than the tail budget implies. A sub-millisecond start offset
  // (identical across one voice's own partials, so timbre is untouched)
  // makes separate notes add as independent waves, not one doubled wave.
  const startAt = now + 0.001 + Math.random() * 0.002;
  const noiseAt = () => Math.random() * (noiseBuffer.duration - 0.5);
  // Never schedule in the past, and never mid-block: startAt is captured
  // BEFORE the ~30 nodes of this voice are created, and on Safari the clock
  // advances during that long task (v8.2: the stale anchor was ~1ms old at
  // schedule time). qa() clamps forward AND lands every noise envelope edge
  // on a block start (see qa above — the chiff junction was the click site).
  // Oscillators keep raw startAt: they begin at phase 0 = value 0 = smooth
  // whenever they hit, and their timing is not a param timeline.
  const liveStart = () => qa(Math.max(startAt, audioCtx.currentTime));

  // Per-voice gain: lets a single voice fade in/out while the note is held
  const voiceGain = audioCtx.createGain();
  // Loudness compensation across pitch: at equal voltage a voice at 55 Hz
  // sounds a good deal quieter than one at 880 Hz (equal-loudness law, plus
  // small speakers' bass roll-off, plus the harmonic stack landing in the
  // ear's sensitive 2-5kHz zone up high). Pre-invert roughly: gentle tilt,
  // +6dB at the bottom, -3dB at the top, so the whole fold range feels even.
  const loud = Math.min(2.0, Math.max(0.6, Math.cbrt(620 / freq)));
  voiceGain.gain.value = loud;
  // Born wired into its own two dormant fade slots (WEBKIT RULE): fin fires
  // once iff the voice is ADDED mid-note, fout once iff it DIES mid-note; a
  // voice born and dying with its note never sees an event here. Unity value
  // and no events = transparent, so the pre-wiring costs nothing and lets
  // every fade be a first-ever event instead of an edge swap.
  const fin = audioCtx.createGain();
  fin.gain.value = 1;
  const fout = audioCtx.createGain();
  fout.gain.value = 1;
  // WARM RULE (see makeChainSegment): fin/fout's first-ever events fire
  // mid-note (fade-in on revoice add, fade-out on release) — under full
  // signal, on cache-cold params: exactly the fireSlot family the v8.4
  // capture caught. Touch both NOW, while this voice's oscillators have not
  // even started (they start at startAt, LOOKAHEAD ahead) — silent x guess =
  // silent.
  const warmAt = warmBlock();
  fin.gain.setValueAtTime(1, warmAt);
  fout.gain.setValueAtTime(1, warmAt);
  voiceGain.connect(fin);
  fin.connect(fout);
  fout.connect(dest);
  nodes.push(voiceGain, fin, fout);

  // Fundamental
  const osc1 = audioCtx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = freq;
  osc1.frequency.setValueAtTime(freq, warmAt); // WARM RULE: glide targets it live
  const gain1 = audioCtx.createGain();
  gain1.gain.value = 1.0;
  osc1.connect(gain1);
  gain1.connect(voiceGain);
  osc1.start(startAt);
  nodes.push(osc1, gain1);

  // Octave partial
  const osc2 = audioCtx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;
  osc2.frequency.setValueAtTime(freq * 2, warmAt);
  const gain2 = audioCtx.createGain();
  gain2.gain.value = 0.12;
  osc2.connect(gain2);
  gain2.connect(voiceGain);
  osc2.start(startAt);
  nodes.push(osc2, gain2);

  // Upper harmonic stack (glides with the fundamental, retunes with body)
  const partials = addHarmonics(freq, voiceGain, startAt);
  for (const p of partials) nodes.push(p.osc, p.gain);

  // Breath noise
  const noiseSrc = audioCtx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;
  noiseSrc.loop = true;
  const bpFilter = audioCtx.createBiquadFilter();
  bpFilter.type = 'bandpass';
  bpFilter.frequency.value = freq;
  bpFilter.Q.value = 2;
  const noiseGain = audioCtx.createGain();
  // The Q=2 bandpass passes noise POWER in proportion to its bandwidth,
  // which grows with center frequency: +3dB per octave of "hiss" if left
  // flat. Scale by 1/sqrt(f) so breath is perceived steady across the range.
  const noiseLvl = 0.04 * Math.min(1.6, Math.max(0.5, Math.sqrt(620 / freq)));
  // BORN SILENT. The v8.3 Safari capture finally named the family: a
  // pre-filled noise BufferSource starting on the SAME grid boundary as its
  // envelope's set(0) pin let one sample escape at the node's DEFAULT gain
  // (1.0 here) — the LOOKAHEAD-blast shape, and control:blast certifies
  // exactly it. Ordering at a shared boundary is engine-impl detail; the
  // defense is that nothing can flow at the default: born 0, ramped up, and
  // the source starts raw (mid-block) so it shares no boundary with any
  // aligned param event.
  noiseGain.gain.value = 0;
  noiseSrc.connect(bpFilter);
  bpFilter.connect(noiseGain);
  noiseGain.connect(voiceGain);
  const nAt = liveStart();
  noiseGain.gain.setValueAtTime(0, nAt); // first event == true value (0)
  // Micro-step then real ramp: the breath ramp now BEGINS on its own grid
  // boundary (nAt+one block) instead of inside the param's first block. If a
  // renderer mis-evaluates a brand-new param's first block (see chiffAt
  // notes), every value it can guess on that block is ~0.
  noiseGain.gain.linearRampToValueAtTime(noiseLvl * 0.01, qa(nAt + Q()));
  noiseGain.gain.linearRampToValueAtTime(noiseLvl, qa(nAt + 2 * Q()));
  noiseSrc.start(startAt, noiseAt());
  nodes.push(noiseSrc, bpFilter, noiseGain);

  // Chiff — KILLED by field experiment ("kill the chiff and retest"). Three
  // Safari captures kept the timeline right next to every click, and every
  // defense (born-silent, 0-pin, micro-step, grid alignment, warm pins)
  // changed nothing. Default build now contains NO chiff at all: no buffer
  // source, no filter, no gain node, no params, no scheduled events — the
  // cleanest acquittal the field can offer. If Safari still clicks, the chiff
  // timeline is out for good; if it goes silent, the v8.2 Δ==chiff-level hit
  // was real all along. `window.chiffOn = true` revives the old envelope
  // (the console-only `chiffOff` knob is retired; the knob inverted).
  let chiffSrc = null;
  let chiffGain = null;
  if (window.chiffOn === true) {
    chiffSrc = audioCtx.createBufferSource();
    chiffSrc.buffer = noiseBuffer;
    chiffSrc.loop = true;
    const chiffFilter = audioCtx.createBiquadFilter();
    chiffFilter.type = 'highpass';
    chiffFilter.frequency.value = freq * 2.5;
    chiffGain = audioCtx.createGain();
    chiffGain.gain.value = 0; // BORN SILENT — see noiseGain above; identical blast
                               // class, and the loudest one (full-scale noise at
                               // this node's default 1.0 was escaping for boundary
                               // samples at chiffAt in the v8.3 capture)
    // A highpass at 2.5f passes the ear's sensitive zone for LOW notes and a
    // dull ultrasonic sliver for high ones; level the perceived chiff a touch.
    const chiffLvl = 0.12 * Math.min(1.25, Math.max(0.75, Math.pow(500 / (freq * 2.5), 0.15)));
    // Ramp in, never snap on (the buffer is full-scale noise at a random
    // offset). set(0) pins the TRUE value (0 — born silent), so even a Safari
    // boundary-ordering inversion yields silence, not the default 1.0. The
    // micro-step (1% in the FIRST block, real ramp from the SECOND) keeps
    // every possible first-block guess silent. All born of the v8.2/v8.3
    // captures — retained verbatim for the revived path.
    const chiffAt = liveStart();
    chiffGain.gain.setValueAtTime(0, chiffAt);
    chiffGain.gain.linearRampToValueAtTime(chiffLvl * 0.01, qa(chiffAt + Q()));
    chiffGain.gain.linearRampToValueAtTime(chiffLvl, qa(chiffAt + 0.006));
    chiffGain.gain.exponentialRampToValueAtTime(0.001, qa(chiffAt + 0.06));
    chiffSrc.connect(chiffFilter);
    chiffFilter.connect(chiffGain);
    chiffGain.connect(voiceGain);
    chiffSrc.start(chiffAt, noiseAt());
    chiffSrc.stop(chiffAt + 0.08);
    nodes.push(chiffSrc, chiffFilter, chiffGain);
  }

  return {
    oscs: [osc1, osc2, ...partials.map(p => p.osc)],
    extra: chiffSrc ? [noiseSrc, chiffSrc] : [noiseSrc],
    nodes, voiceGain, fin, fout, partials, freq, key, loud, chiffGain,
  };
}

function destroyVoice(v) {
  for (const node of v.nodes) {
    try { node.disconnect(); } catch(e) {}
  }
}

// CLICK RULE (click-test.mjs + its controls, definitive): an AudioParam's
// timeline must NEVER be modified while the param carries signal. Any
// change — cancel-and-re-pin, past anchor, future anchor, even a
// set-to-the-current-value — makes the renderer compute the next block's
// FIRST sample from the param's first cached event instead of its current
// value: a one-sample hole or bump the size of that segment. Anchoring a
// fresh stage whose very first event pins the value it actually holds makes
// the artifact sample CORRECT, because it is that event's value.
// So: fades and re-levels never edit an in-flight envelope. They ride a
// unity GainNode ("stage"); its events are scheduled once and never touched.
// Stages multiply, so a note can carry trim, re-aim, and release stages.

// WEBKIT RULE (pop-probe v7, Safari field, release at t=7.4347): a
// disconnect+connect pair issued in ONE task can split across render quanta —
// the removed edge goes silent on the next block while the replacing stage
// isn't wired until the block after. The destination sees a full quantum of
// ZERO input: 128 samples of pure silence mid-ramp (probe caught the wave
// [-0.19 ... +0.067, then 0 0 0 0 ...]). Chromium locks the graph per quantum,
// so the offline harness is blind to this. Therefore: NEVER swap edges while
// signal flows.
// Fix: every note is born wired into a chain of dormant unity slots (value 1,
// zero events = fully transparent). Each transition consumes the next slot and
// fires its FIRST-EVER event, pinned at the value the slot actually holds (1)
// — clean by the CLICK RULE. Transitions become pure param events: zero
// connect/disconnect while anything sounds. Disconnect survives only in
// cleanup timers for nodes faded to silence, where a stray zero-input block
// is zero x anything.
// Churn cannot exhaust the chain: when the last fired slot is reached, a new
// dormant segment is GROWN onto the tail (one task-local edge swap per 32
// transitions — the only live rewiring left in the engine, logged as GROW).
const NOTE_SLOTS = 32; // dormant slots per chain segment

function makeChainSegment() {
  const chain = [];
  // WARM RULE (v8.5 field law): a param's FIRST-EVER event is mis-evaluated
  // for ~one block on Safari when signal is already flowing — the v8.4 capture
  // flagged 16/16 CLICKs at fireSlot moments (Δ scaled with the live mix and
  // the ×mult, not with any envelope value). Dormant slots were BORN-READY but
  // CACHE-COLD under a sounding note. So: touch every slot once at creation
  // with a value-equal pin in the PREVIOUS block (warmBlock) — a segment the
  // renderer has already evaluated silently while the note's own gain is
  // pinned to 0. Whatever a renderer guesses on a cold param's first block,
  // silent x guess = silent. From then on, firing a slot is just a segment
  // join on a warm param — the one case every Safari capture agrees is safe.
  const warmAt = warmBlock();
  for (let i = 0; i < NOTE_SLOTS; i++) {
    const s = audioCtx.createGain();
    s.gain.value = 1; // dormant: transparent, no events until fired once
    s.gain.setValueAtTime(1, warmAt); // warm the cache with a no-op (value IS 1)
    if (chain.length) chain[chain.length - 1].connect(s);
    chain.push(s);
  }
  return chain;
}

function makeChain(dest) {
  const chain = makeChainSegment();
  chain[chain.length - 1].connect(dest);
  return chain;
}

// Grow a fresh dormant segment onto the chain tail. Order matters (WEBKIT
// RULE): feed the new segment and land it on the bus BEFORE detaching the old
// tail, so a Safari quantum-split between the ops can only ever double the
// note's path briefly — never starve the bus into a silence block.
function growChain(gr) {
  const tail = gr.chain[gr.chain.length - 1];
  const seg = makeChainSegment();
  tail.connect(seg[0]);
  seg[seg.length - 1].connect(masterGain);
  // SCOPED disconnect: bare tail.disconnect() would also sever the brand-new
  // tail->seg[0] edge made one line above (it removes EVERY output), orphaning
  // the whole segment — silent note forever. chain-add.mjs + the
  // slot-exhaustion scene caught exactly this.
  try { tail.disconnect(masterGain); } catch (e) {}
  for (const s of seg) gr.chain.push(s);
}

// Fire the note's next dormant slot: multiply its path by `mult`. Only ever
// called on a never-fired slot, so the first event pins the slot's true
// value (CLICK RULE); the slot is pre-wired, so no edge swaps (WEBKIT RULE).
// A fired stage never gets a second event; concurrent ramps multiply —
// env x r1 x r2, exactly the telescoping total-constant law of one r per step.
function fireSlot(group, now, mult, dur) {
  if (!group || !group.chain) return false; // chainless entry: nothing to fade
  if (group.slot >= group.chain.length) growChain(group);
  const stage = group.chain[group.slot++];
  stage.gain.setValueAtTime(1, qa(now));
  stage.gain.linearRampToValueAtTime(mult, qa(now + dur));
  return true;
}

// A note's audible level: envelope x everything fired slots have faded to.
function chainLevel(gr) {
  let lvl = gr.gain.gain.value;
  for (let i = 0; i < gr.slot; i++) lvl *= gr.chain[i].gain.value;
  return lvl;
}

function stopVoicesAt(voiceList, when, extraNodes) {
  // Hard-stop voices on the audio clock at `when` (they must be silent by
  // then — stopping an audible oscillator clicks). setTimeout only handles
  // disconnecting nodes that are already silent.
  releasing.add(voiceList);
  for (const v of voiceList) {
    for (const node of [...v.oscs, ...v.extra]) {
      try { node.stop(when); } catch(e) {}
    }
  }
  const ms = Math.max(0, (when - audioCtx.currentTime) * 1000) + 50;
  setTimeout(() => {
    for (const v of voiceList) destroyVoice(v);
    for (const n of extraNodes || []) { try { n.disconnect(); } catch(e) {} }
    releasing.delete(voiceList);
  }, ms);
}

// Release a whole note: fade the note's OWN gain, leaving notes that started
// later (or are still fading) completely untouched — envelopes don't share.
function releaseVoices(voiceList, fadeTime, gain) {
  const now = audioCtx.currentTime;
  let gr = null;
  for (let i = noteGroups.length - 1; i >= 0; i--) {
    if (noteGroups[i].gain === gain) { gr = noteGroups[i]; break; }
  }
  // fireSlot grows the chain on demand, so a grouped note always has a slot
  if (gr) {
    fireSlot(gr, now, 0, fadeTime);
    // cleanup list: the note's gain + its whole slot chain — all silent when
    // the timer fires, so those disconnects are invisible (WEBKIT RULE).
    // qa: cleanup must not precede the block-aligned fade end.
    stopVoicesAt(voiceList, qa(now + fadeTime), [gain].concat(gr.chain));
  } else {
    // registry lost this note (already trimmed to silence): just hard-stop
    stopVoicesAt(voiceList, qa(now + fadeTime), [gain]);
  }
}

function vectorKey(v) {
  return v.exp.join(',');
}

function getVoiceVectors() {
  const rootVec = new PrimeVector(0, 0, 0, 0);

  // Build voice set from chord + additive using XOR
  const chordVecMap = new Map(); // vectorKey -> vector (excluding root)
  if (activeChord) {
    for (const v of CHORD_PRESETS[activeChord].voices) {
      const key = vectorKey(v);
      if (key !== vectorKey(rootVec)) {
        chordVecMap.set(key, v);
      }
    }
  }

  const additiveVecMap = new Map(); // vectorKey -> vector
  for (const code of activeAdditives) {
    const v = ADDITIVE_RATIOS[code].vector;
    additiveVecMap.set(vectorKey(v), v);
  }

  // XOR: include voices that are in chord XOR additive (in one but not both)
  const voiceVectors = [rootVec];

  for (const [key, vec] of chordVecMap) {
    if (!additiveVecMap.has(key)) {
      voiceVectors.push(vec);
    }
  }
  for (const [key, vec] of additiveVecMap) {
    if (!chordVecMap.has(key)) {
      voiceVectors.push(vec);
    }
  }

  if (invertedMode) {
    // Invert mode: every voice but the root becomes its reciprocal, so the
    // chord hangs below the root (major = root + 4:5 + 2:3)
    return voiceVectors.map(v => v.isZero() ? v : v.negate());
  }
  return voiceVectors;
}

function getChordVoicing() {
  const rootFreq = getAudibleFreq();
  return getVoiceVectors().map(v => ({
    key: vectorKey(v),
    freq: rootFreq * v.toFrequency(1),
  }));
}

function startTone() {
  if (isSounding) return;
  initAudio();

  const voicing = getChordVoicing();
  const perVoiceVolume = VOLUME / voicing.length;

  const now = audioCtx.currentTime;

  // Tail budget: release tails may ring and overlap freely — that's the
  // organ breathing — until the SUM of note gains would push the mix past
  // headroom (fast spam stacking clips). Then the OLDEST tails are trimmed
  // with a fast exponential fade: click-free from any level, unlike the
  // old 10ms linear slam that popped. Relaxed playing never hits this.
  let sum = perVoiceVolume; // the incoming note
  const keepers = [];
  for (let i = noteGroups.length - 1; i >= 0; i--) { // newest tails matter most
    const gr = noteGroups[i];
    // A note's AUDIBLE level is its envelope times whatever its fired slots
    // have faded it to (a releasing note still holds its envelope value while
    // a slot, not the envelope, rides it to zero)
    const lvl = chainLevel(gr);
    if (lvl <= 0.01) continue; // effectively silent: drop, let it self-expire
    if (sum + lvl > TAIL_BUDGET) {
      // Duck the old tail: dormant slot, first event pins its own current
      // value (1), ramped to zero — the note's envelope is never edited
      // mid-flight (CLICK RULE above the slot chain). Every cancel-and-re-pin
      // variant spikes the next block's first sample; linear stays as the
      // shape (exact zero, mirrors the release path).
      fireSlot(gr, now, 0, TAIL_TRIM);
      stopVoicesAt(gr.voices, qa(now + TAIL_TRIM + 0.01), [gr.gain].concat(gr.chain));
      continue;
    }
    sum += lvl;
    keepers.push(gr);
  }
  keepers.reverse();

  // Each note gets its own gain node: attacks and releases are private, so
  // a re-attack never steals from — or clicks through — a note still fading.
  // The envelope is anchored LOOKAHEAD into the future, not at `now`:
  // ctx.currentTime trails the render thread (>=1 block, far more when the
  // main thread is buried under spam + redraws). An envelope that starts in
  // the past is already midway through its ramp when it commits, so the note
  // SNAPS into the mix at (lag/attack)x level instead of swelling in — a
  // voice-sized step at a random phase: exactly the +6ms-after-startTone,
  // full-swing, smooth-either-side clicks pop-probe corroborated x2 reads.
  // Scheduled ahead, the ramp is honestly rendered from true zero.
  const t0 = now + LOOKAHEAD;
  noteGain = audioCtx.createGain();
  // Pin at ZERO on creation: a fresh GainNode's gain DEFAULTS TO 1.0, the
  // oscillators start ~2ms in (before t0!), so without this the note blasts
  // at full scale for one LOOKAHEAD then snaps to the pin — a blast+drop
  // click on EVERY note. pop-probe v5 caught exactly this: full-scale
  // corroborated steps at t0 on essentially every startTone.
  noteGain.gain.value = 0;
  // The note is BORN wired into its dormant slot chain (WEBKIT RULE near
  // the slot chain): every later fade rides a slot, so this edge is never moved.
  const chain = makeChain(masterGain);
  noteGain.connect(chain[0]);
  const g = noteGain.gain;
  g.setValueAtTime(0, qa(t0));
  g.linearRampToValueAtTime(perVoiceVolume, qa(t0 + envelope.attack));
  g.linearRampToValueAtTime(perVoiceVolume * envelope.sustain,
    qa(t0 + envelope.attack + envelope.decay));

  voices = voicing.map(s => createVoice(s.freq, s.key, noteGain));
  noteGroups = keepers;
  noteGroups.push({ gain: noteGain, voices, chain, slot: 0 });

  isSounding = true;
  stateDisplay.textContent = 'sounding';
  stateDisplay.classList.add('sounding');
}

function stopTone() {
  if (!isSounding) return;

  releaseVoices(voices, envelope.release, noteGain);
  voices = [];
  noteGain = null;
  isSounding = false;
  stateDisplay.textContent = 'idle';
  stateDisplay.classList.remove('sounding');
}

// preserveLevel=true skips the loudness rebalance. A pivot landing must not
// swell the survivor: it keeps ringing as the root at the very level it had
// as a chord voice (a chord collapsing to 1 voice would otherwise jump 3x).
function updateFrequencyIfSounding(preserveLevel) {
  if (!isSounding) return;
  const keepLevel = preserveLevel === true; // never trust event args

  const voicing = getChordVoicing();
  const now = audioCtx.currentTime;
  const want = new Map(voicing.map(s => [s.key, s.freq]));

  // Diff voices by prime vector, not by hz: shared ratios keep sounding
  // untouched (no re-attack, no click); only changed voices crossfade.
  const kept = [];
  const dying = [];
  for (const v of voices) {
    if (want.has(v.key)) {
      // consume the match: one voicing entry pairs with one voice, never two,
      // so a stale duplicate key fades out instead of doubling the pitch
      kept.push({ voice: v, freq: want.get(v.key) });
      want.delete(v.key);
    } else {
      dying.push(v);
    }
  }

  // Dying voices fade through their own dormant fout slot: first event pins
  // the slot's true value (CLICK RULE), nothing is rewired (WEBKIT RULE).
  for (const v of dying) {
    const g = v.fout.gain;
    g.setValueAtTime(1, qa(now));
    g.linearRampToValueAtTime(0, qa(now + VOICE_FADE));
  }
  if (dying.length > 0) stopVoicesAt(dying, qa(now + VOICE_FADE));

  const haveKeys = new Set(kept.map(k => k.voice.key));
  const added = [];
  for (const s of voicing) {
    if (haveKeys.has(s.key)) continue;
    const v = createVoice(s.freq, s.key, noteGain);
    // Fade-in rides the voice's born-wired fin slot. Deliberate twist: the
    // slot's true value is 1, so this first event is NOT its current value —
    // the CLICK-RULE artifact sample equals the first event's value, which is
    // 0: exactly what a just-born voice contributes at that moment (its
    // oscillator has not even started for +1-3ms, and pop-probe v7 caught the
    // old cancel-and-re-pin version of this path punching a 0.227 hole out of
    // the mix one block later). Chromium renders no artifact at all.
    // finAt re-clamps to the live clock: createVoice just spent real time
    // (clock advances during the task on Safari), so the loop's `now` is
    // already stale — a past-anchored fade-in eats its own ramp and the
    // voice steps into the mix at partial level (v8.2 field capture class).
    const finAt = Math.max(now, audioCtx.currentTime);
    const f = v.fin.gain;
    f.setValueAtTime(0, finAt);
    f.linearRampToValueAtTime(1, finAt + Math.max(envelope.attack, VOICE_FADE));
    added.push({ voice: v, freq: s.freq });
  }

  voices = kept.concat(added).map(k => k.voice);

  // keep the tail-budget registry's view of this note current
  const group = noteGroups[noteGroups.length - 1];
  if (group && group.gain === noteGain) group.voices = voices;

  // Keep total loudness steady as the voice count changes. All voices sit at
  // roughly the same per-voice level, so the note's TOTAL just needs scaling
  // by n_before/n_after: the next dormant slot glides there within one
  // VOICE_FADE, multiplying whatever the envelope is already doing — the
  // swell keeps going, the envelope is never edited (CLICK RULE), and fired
  // stages multiply, so a run of re-aims telescopes to n_start/n_end and the
  // total stays constant (no re-aim ever re-reads or rewrites a past slot).
  if (!keepLevel && (dying.length > 0 || added.length > 0)) {
    const nBefore = kept.length + dying.length;
    const nAfter = voices.length;
    if (nBefore > 0 && nAfter > 0 && nBefore !== nAfter) {
      // fresh clock: createVoice (above) may have consumed ms of it
      fireSlot(group, Math.max(now, audioCtx.currentTime), nBefore / nAfter, VOICE_FADE); // grows the chain on demand
    }
  }

  // EXPERIMENT (pop-probe v8.2 hypothesis): setTargetAtTime on a SOUNDING
  // oscillator/bandpass frequency is the last live-timeline modification in
  // the engine. It renders sample-accurately in Chromium (harness green) but
  // Safari's click reports correlate with keystroke retunes, not with the
  // (now-pure-param) level slots. `window.freqGlide = false` in the console
  // turns this whole block off: kept voices hold their old pitch until the
  // next note-on. If the clicks vanish, the glide is the culprit.
  if (window.freqGlide === false) {
    for (const { voice: v, freq } of kept.concat(added)) v.freq = freq;
    return;
  }

  // Glide to target frequencies (no-op for voices whose freq didn't change)
  for (const { voice: v, freq } of kept.concat(added)) {
    v.oscs[0].frequency.setTargetAtTime(freq, now, 0.02);
    v.oscs[1].frequency.setTargetAtTime(freq * 2, now, 0.02);
    for (const p of v.partials) p.osc.frequency.setTargetAtTime(freq * p.mult, now, 0.02);
    v.nodes.forEach(n => {
      if (n instanceof BiquadFilterNode && n.type === 'bandpass') {
        n.frequency.setTargetAtTime(freq, now, 0.02);
      }
    });
    v.freq = freq;
  }
}

// === Timbre ===

// Live-retune every sounding voice's harmonic stack
function setBody(value) {
  body = value;
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  for (const v of voices) {
    for (const p of v.partials) p.gain.gain.setTargetAtTime(p.mix * body, now, 0.02);
  }
  if (humNodes) {
    for (const p of humNodes.partials) p.gain.gain.setTargetAtTime(p.mix * body, now, 0.02);
  }
}

function setupBodyControl() {
  const input = document.getElementById('body-ctl');
  const label = document.getElementById('body-val');
  label.textContent = parseFloat(input.value).toFixed(2);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    label.textContent = v.toFixed(2);
    setBody(v);
  });
}

function setupVolumeControl() {
  const input = document.getElementById('vol-ctl');
  const label = document.getElementById('vol-val');
  label.textContent = (parseFloat(input.value) || 1).toFixed(2);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (!Number.isFinite(v)) return;
    masterVolume = v;
    label.textContent = v.toFixed(2);
    if (audioCtx) {
      // Glide, don't jump: a gain step mid-note is a click by definition.
      masterGain.gain.setTargetAtTime(v, audioCtx.currentTime, 0.02);
    }
  });
}

// === Tonic Hum ===

function startHum() {
  if (humNodes) return;
  initAudio();

  const freq = foldToAudible(baseHz);
  const now = audioCtx.currentTime;
  const warmAt = warmBlock(); // WARM RULE (see makeChainSegment)

  // The hum rides the shared bus too: its own gain node keeps it independent
  // of the note envelopes, the master volume scales it with everything else,
  // and the output limiter catches hum + notes together.
  const gain = audioCtx.createGain();
  gain.gain.value = 0; // not 1.0, even briefly: the osc starts immediately
  gain.gain.setValueAtTime(0, qa(now));
  gain.gain.linearRampToValueAtTime(HUM_VOLUME, qa(now + HUM_FADE));
  // Born-wired dormant fade slot (WEBKIT RULE): stopHum fires its first event
  // instead of splicing an edge between the hum and the bus.
  const fade = audioCtx.createGain();
  fade.gain.value = 1;
  fade.connect(masterGain);
  gain.connect(fade);

  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.frequency.setValueAtTime(freq, warmAt);
  osc.connect(gain);
  osc.start();

  // Subtle octave partial for a little body, like the main voice
  const osc2 = audioCtx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;
  osc2.frequency.setValueAtTime(freq * 2, warmAt);
  const gain2 = audioCtx.createGain();
  gain2.gain.value = 0.12;
  osc2.connect(gain2);
  gain2.connect(gain);
  osc2.start();

  // The drone gets the harmonic stack too: it becomes a full tuning fork
  const partials = addHarmonics(freq, gain, now);

  humNodes = { oscs: [osc, osc2, ...partials.map(p => p.osc)], gains: [gain, gain2], partials, fade };
  setHumActive(true);
}

function stopHum() {
  if (!humNodes) return;

  const now = audioCtx.currentTime;
  const fade = humNodes.fade;
  fade.gain.setValueAtTime(1, qa(now)); // first event == its true value (CLICK RULE)
  fade.gain.linearRampToValueAtTime(0, qa(now + HUM_FADE));

  const dying = humNodes;
  humNodes = null;
  for (const osc of dying.oscs) { try { osc.stop(qa(now + HUM_FADE) + 0.01); } catch(e) {} }
  setTimeout(() => {
    // everything here is inaudible by now, so these disconnects are invisible
    for (const node of dying.gains) { try { node.disconnect(); } catch(e) {} }
    try { fade.disconnect(); } catch(e) {}
  }, HUM_FADE * 1000 + 60);

  setHumActive(false);
}

function toggleHum() {
  if (humNodes) stopHum(); else startHum();
}

function setHumActive(on) {
  humIndicator.classList.toggle('active', on);
  highlightKey('Period', on);
}

// The hum tracks the initial root as the slider moves
function retuneHum() {
  if (!humNodes) return;
  const freq = foldToAudible(baseHz);
  const now = audioCtx.currentTime;
  humNodes.oscs[0].frequency.setTargetAtTime(freq, now, 0.02);
  humNodes.oscs[1].frequency.setTargetAtTime(freq * 2, now, 0.02);
  for (const p of humNodes.partials) p.osc.frequency.setTargetAtTime(freq * p.mult, now, 0.02);
}

// === Step Pivot Chord Mode ===

const ROOT_KEY = vectorKey(new PrimeVector(0, 0, 0, 0));
const LEAVING_KEY = 'leaving'; // voice tag: matches nothing, fades out on the next diff

function togglePivot() {
  pivotMode = !pivotMode;
  pivotIndicator.classList.toggle('active', pivotMode);
  highlightKey('KeyN', pivotMode);
}

// The pivot lands on the voice farthest from the root (in log space): the
// highest normally, the lowest when inverted. Not folded hz, which folding
// could scramble.
function pivotDistance(vec) {
  const r = vec.toFrequency(1);
  return Math.max(r, 1 / r);
}

function getPivotVoiceVector() {
  let farthest = null;
  for (const v of getVoiceVectors()) {
    if (!farthest || pivotDistance(v) > pivotDistance(farthest)) {
      farthest = v;
    }
  }
  return farthest;
}

function pivotLabel(vec) {
  return `pivot ${VOICE_LABELS[vectorKey(vec)] || 'voice'}`;
}

// Pivot at note-off: the chord already finished ringing; step the root silently.
function pivotRoot() {
  if (!pivotMode) return;

  const farthest = getPivotVoiceVector();
  if (!farthest || farthest.isZero()) return; // root only: nothing to step to

  const label = pivotLabel(farthest);
  pushUndo(farthest, label);
  currentVector = currentVector.add(farthest);
  updateDisplay(label);
}

// Pivot while still holding space (chord cleared with , in pivot mode):
// the voices nearer the root crossfade out and the farthest voice relabels
// as the new root, so it keeps ringing with no re-attack — its frequency
// equals the new root's, modulo octave folding.
function landOnPivotVoice() {
  const farthest = getPivotVoiceVector();
  if (!farthest || farthest.isZero()) {
    clearVoicing();
    updateDisplay();
    updateFrequencyIfSounding(true); // landing never rebalances the level
    return;
  }

  const outerVoice = voices.find(v => v.key === vectorKey(farthest));
  if (outerVoice) {
    // The old root voice now plays UNDER the new root — left tagged ROOT_KEY
    // it would survive the diff beside the relabeled outer voice and double
    // the pitch. Retag it so the voice diff fades it out like any departure.
    const oldRoot = voices.find(v => v !== outerVoice && v.key === ROOT_KEY);
    if (oldRoot) oldRoot.key = LEAVING_KEY;
    outerVoice.key = ROOT_KEY; // relabel before the voice diff so it survives
  }

  const label = pivotLabel(farthest);
  pushUndo(farthest, label);
  currentVector = currentVector.add(farthest);

  clearVoicing();
  updateDisplay(label);
  updateFrequencyIfSounding(true); // the landed voice keeps its chord-level mix
}

// === Invert Mode ===

// Chord and additive voices become their reciprocals: chords hang below the
// root (major = root + 4:5 + 2:3) and the pivot steps downward. Left-hand
// root navigation is unaffected. Toggling while a chord sounds live-flips
// the voicing via the voice crossfade.
function toggleInvert() {
  invertedMode = !invertedMode;
  invertIndicator.classList.toggle('active', invertedMode);
  highlightKey('KeyM', invertedMode);
  updateDisplay();
  if (isSounding) updateFrequencyIfSounding();
}

// === Hold / Perform Mode ===

// In hold mode, voicing keys are momentary: chord presets and additive
// ratios only sound while physically pressed (mouse holds behave the same).

const MODE_KEYS = new Set(['Period', 'KeyN', 'Slash', 'KeyM']); // their highlight reflects mode state

function toggleHold() {
  holdMode = !holdMode;
  clearVoicing();
  holdIndicator.classList.toggle('active', holdMode);
  highlightKey('Slash', holdMode);
  if (isSounding) updateFrequencyIfSounding();
}

// Chord keys keep mutual exclusion while momentary: each press goes on top
// of the stack, releasing reveals a still-held chord underneath.
function pressHeldChord(code) {
  const i = heldChordStack.indexOf(code);
  if (i !== -1) heldChordStack.splice(i, 1);
  heldChordStack.push(code);
  applyHeldChordStack();
}

function releaseHeldChord(code) {
  const i = heldChordStack.indexOf(code);
  if (i === -1) return;
  heldChordStack.splice(i, 1);
  applyHeldChordStack();
}

function applyHeldChordStack() {
  const top = heldChordStack.length > 0 ? heldChordStack[heldChordStack.length - 1] : null;
  if (activeChord === top) return;
  if (activeChord) highlightKey(activeChord, false);
  activeChord = top;
  if (top) highlightKey(top, true);
  updateDisplay();
  updateFrequencyIfSounding();
}

function pressHeldAdditive(code) {
  activeAdditives.add(code);
  highlightKey(code, true);
  updateDisplay();
  updateFrequencyIfSounding();
}

function releaseHeldAdditive(code) {
  if (!activeAdditives.delete(code)) return;
  highlightKey(code, false);
  updateDisplay();
  updateFrequencyIfSounding();
}

// === Overtones View ===

// Draws every sounding voice's partial stack on a log-frequency axis and
// marks where partials of DIFFERENT voices collide: dead-on = tuning locks,
// near-but-off inside the roughness band = the audible buzz. What you see is
// the beating physics itself; quieter partials (low brightness) honestly
// produce fainter marks, because they genuinely beat less audibly.

const harmonicCanvas = document.getElementById('harmonic-canvas');
const hvCtx = harmonicCanvas.getContext('2d');

const HV_LOW = 40;      // Hz range of the axis
const HV_HIGH = 8000;
const HV_RATIO_LOG = Math.log(HV_HIGH / HV_LOW);

function hvX(f, w) {
  return w * (Math.log(f / HV_LOW) / HV_RATIO_LOG);
}

function hvPartials() {
  // Partials actually present in a voice, with their current amplitudes
  const list = [{ n: 1, a: 1 }, { n: 2, a: 0.12 }];
  for (const p of PARTIAL_MIX) {
    if (p.mix * body > 0.001) list.push({ n: p.mult, a: p.mix * body });
  }
  return list;
}

function drawOvertoneView() {
  const dpr = window.devicePixelRatio || 1;
  const w = harmonicCanvas.clientWidth;
  const h = 150;
  if (harmonicCanvas.width !== w * dpr || harmonicCanvas.height !== h * dpr) {
    harmonicCanvas.width = w * dpr;
    harmonicCanvas.height = h * dpr;
  }
  const ctx = hvCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // octave grid at powers-of-two above 55
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  for (const gridF of [55, 110, 220, 440, 880, 1760, 3520, 7040]) {
    const x = hvX(gridF, w);
    ctx.strokeStyle = '#1e1e32';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.fillStyle = '#4a4a66';
    ctx.fillText(String(gridF), x, h - 4);
  }

  // Collect sources: hum, held voices, fading voices (dimmer)
  const sources = [];
  if (humNodes) {
    sources.push({ freq: foldToAudible(baseHz), color: '#e6b877', dim: 1, label: true });
  }
  for (const v of voices) sources.push({ freq: v.freq, color: '#7fdbca', dim: 1, label: true });
  for (const group of releasing) {
    for (const v of group) sources.push({ freq: v.freq, color: '#7fdbca', dim: 0.35, label: false });
  }

  // Partial ticks per source
  const partials = hvPartials();
  const seen = []; // {f, a, src}
  for (const s of sources) {
    for (const p of partials) {
      const f = s.freq * p.n;
      if (f < HV_LOW || f > HV_HIGH) continue;
      const x = hvX(f, w);
      const tickH = 6 + 60 * Math.sqrt(Math.min(1, p.a));
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = s.dim * Math.min(1, 0.25 + p.a * 3);
      ctx.lineWidth = p.n === 1 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, h - 16);
      ctx.lineTo(x, h - 16 - tickH);
      ctx.stroke();
      if (p.n === 1 && s.label) {
        ctx.globalAlpha = s.dim;
        ctx.fillStyle = s.color;
        ctx.font = '9px monospace';
        ctx.fillText('≈' + approxNoteName(s.freq), x, h - 16 - tickH - 4);
      }
      seen.push({ f, a: p.a * s.dim, color: s.color, src: s });
    }
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;

  // Cross-source partial collisions
  const marks = [];
  for (let i = 0; i < seen.length; i++) {
    for (let j = i + 1; j < seen.length; j++) {
      const A = seen[i], B = seen[j];
      if (A.src === B.src) continue;
      const df = Math.abs(A.f - B.f);
      const rel = df / Math.min(A.f, B.f);
      const strength = Math.min(A.a, B.a);
      if (strength < 0.003) continue; // both partials must actually carry sound
      if (rel < 0.004) {
        marks.push({ f: (A.f + B.f) / 2, kind: 'lock', strength });
      } else if (df < 45 && rel < 0.06) {
        marks.push({ f: (A.f + B.f) / 2, kind: 'buzz', strength, df });
      }
    }
  }
  marks.sort((a, b) => b.strength - a.strength);
  const drawn = [];
  for (const m of marks) {
    if (drawn.some(d => Math.abs(d - m.f) / m.f < 0.004)) continue; // one mark per freq
    drawn.push(m.f);
    if (drawn.length > 8) break;
    const x = hvX(m.f, w);
    if (m.kind === 'lock') {
      ctx.fillStyle = '#ffe9a8';
      ctx.globalAlpha = 0.5 + Math.min(0.5, m.strength * 4);
      ctx.beginPath();
      ctx.arc(x, 10, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#ff8080';
      ctx.globalAlpha = 0.5 + Math.min(0.5, m.strength * 4);
      ctx.beginPath();
      ctx.moveTo(x - 3, 7); ctx.lineTo(x + 3, 13);
      ctx.moveTo(x + 3, 7); ctx.lineTo(x - 3, 13);
      ctx.stroke();
      if (drawn.length <= 3 && m.df > 1) {
        ctx.fillStyle = '#ff8080';
        ctx.font = '8px monospace';
        ctx.fillText('Δ' + m.df.toFixed(1) + 'Hz', x, 22);
      }
    }
  }
  ctx.globalAlpha = 1;

  if (sources.length === 0) {
    ctx.fillStyle = '#4a4a66';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('hold space — every voice shows its overtone ghost-stack here', w / 2, h / 2);
  }
}

function overtoneLoop() {
  drawOvertoneView();
  updateSessionStatus();
  requestAnimationFrame(overtoneLoop);
}

// === Display ===

function updateDisplay(moveName) {
  const freq = getAudibleFreq();

  hzDisplay.textContent = `${freq.toFixed(2)} Hz`;
  noteDisplay.textContent = `≈ ${approxNoteName(freq)}`;
  for (let i = 0; i < 4; i++) {
    vecEls[i].textContent = currentVector.exp[i];
  }

  if (moveName) {
    moveDisplay.textContent = `${moveName}`;
  } else if (currentVector.isZero()) {
    moveDisplay.textContent = 'root';
  }

  // Chord display
  chordDisplay.textContent = chordLabel() || 'none';
}

// Current chord + additive display text, e.g. "Major Triad + 9:8"
function chordLabel() {
  const parts = [];
  if (activeChord) {
    parts.push(CHORD_PRESETS[activeChord].name);
  }
  for (const code of activeAdditives) {
    const ratio = ADDITIVE_RATIOS[code].ratio;
    parts.push(invertedMode ? flipRatio(ratio) : ratio);
  }
  return parts.join(' + ');
}

// Invert a ratio label: "5:4" -> "4:5"
function flipRatio(r) {
  const [a, b] = r.split(':');
  return b + ':' + a;
}

// === Key Highlight ===

function highlightKey(code, on) {
  const el = document.querySelector(`.cheat-key[data-key="${code}"]`);
  if (el) el.classList.toggle('active', on);
}

// === Help Overlay ===

const overlayEl = document.getElementById('overlay');
const helpBtn = document.getElementById('help-btn');
const overlayCloseBtn = document.getElementById('overlay-close');

function toggleOverlay(force) {
  const show = typeof force === 'boolean' ? force : overlayEl.classList.contains('hidden');
  overlayEl.classList.toggle('hidden', !show);
  helpBtn.classList.toggle('active', show);
}

helpBtn.addEventListener('click', () => toggleOverlay());
overlayCloseBtn.addEventListener('click', () => toggleOverlay(false));
overlayEl.addEventListener('click', (e) => {
  if (e.target === overlayEl) toggleOverlay(false); // backdrop click
});

// === Undo / Redo ===

function pushUndo(delta, description) {
  undoStack.push({ delta, description });
  redoStack = [];
}

function undo() {
  if (undoStack.length === 0) return;
  const action = undoStack.pop();
  currentVector = currentVector.add(action.delta.negate());
  redoStack.push(action);
  updateDisplay(`undo: ${action.description}`);
  updateFrequencyIfSounding();
}

function redo() {
  if (redoStack.length === 0) return;
  const action = redoStack.pop();
  currentVector = currentVector.add(action.delta);
  undoStack.push(action);
  updateDisplay(`redo: ${action.description}`);
  updateFrequencyIfSounding();
}

// === Keyboard Input ===

// Deactivate chord preset + additive toggles (and their key highlights)
function clearVoicing() {
  if (activeChord) {
    highlightKey(activeChord, false);
    activeChord = null;
  }
  for (const code of activeAdditives) {
    highlightKey(code, false);
  }
  activeAdditives.clear();
  heldChordStack = [];
}

function handleKeyDown(e) {
  // Keys typed into the score editor are text, not a performance:
  // typing "h" in the score must not sound an H chord.
  if (e.target && e.target.tagName === 'TEXTAREA') return;

  // Always suppress space's default (page scroll / activating a focused
  // control) — including auto-repeat events, which bail out below.
  // Without this, holding space long enough starts page-downing the app.
  if (e.code === 'Space') e.preventDefault();

  if (e.repeat) return;

  recordKeyEvent(e, true);

  if (e.code === 'Escape') {
    e.preventDefault();
    toggleOverlay(false);
    stopPlayback();
    return;
  }

  if (e.code === 'Space') {
    highlightKey('Space', true);
    startTone();
    return;
  }

  if (e.code === 'Digit0') {
    e.preventDefault();
    highlightKey('Digit0', true);
    const resetDelta = currentVector.negate();
    if (!resetDelta.isZero()) {
      pushUndo(resetDelta, 'reset');
    }
    currentVector = new PrimeVector(0, 0, 0, 0);
    lastMove = null;
    updateDisplay('reset');
    updateFrequencyIfSounding();
    return;
  }

  // Undo / Redo
  if (e.code === 'Backspace') {
    e.preventDefault();
    undo();
    return;
  }

  if (e.code === 'Backslash') {
    e.preventDefault();
    redo();
    return;
  }

  // Chord presets (mutually exclusive; momentary in hold mode)
  if (CHORD_PRESETS[e.code]) {
    e.preventDefault();
    if (holdMode) {
      pressHeldChord(e.code);
      return;
    }
    // Clear additives when switching chord
    if (activeAdditives.size > 0) {
      for (const code of activeAdditives) {
        highlightKey(code, false);
      }
      activeAdditives.clear();
    }
    // If already active, deactivate
    if (activeChord === e.code) {
      highlightKey(e.code, false);
      activeChord = null;
    } else {
      // Clear previous chord highlight
      if (activeChord) {
        highlightKey(activeChord, false);
      }
      highlightKey(e.code, true);
      activeChord = e.code;
    }
    updateDisplay();
    updateFrequencyIfSounding();
    return;
  }

  // Additive ratio toggles (non-exclusive; momentary in hold mode)
  if (ADDITIVE_RATIOS[e.code]) {
    e.preventDefault();
    if (holdMode) {
      pressHeldAdditive(e.code);
      return;
    }
    if (activeAdditives.has(e.code)) {
      activeAdditives.delete(e.code);
      highlightKey(e.code, false);
    } else {
      activeAdditives.add(e.code);
      highlightKey(e.code, true);
    }
    updateDisplay();
    updateFrequencyIfSounding();
    return;
  }

  // Clear chord + additives
  if (e.code === 'Comma') {
    e.preventDefault();
    highlightKey('Comma', true);
    // In pivot mode, clearing a sounding chord "lands" the root on its
    // outermost voice: the chord fades and that voice continues as new root.
    if (pivotMode && isSounding) {
      landOnPivotVoice();
    } else {
      clearVoicing();
      updateDisplay();
      updateFrequencyIfSounding();
    }
    return;
  }

  // Tonic hum toggle
  if (e.code === 'Period') {
    e.preventDefault();
    toggleHum();
    return;
  }

  // Step pivot mode toggle
  if (e.code === 'KeyN') {
    e.preventDefault();
    togglePivot();
    return;
  }

  // Hold/perform mode toggle (/); ? opens the field guide
  if (e.code === 'Slash') {
    e.preventDefault();
    if (e.key === '?') {
      toggleOverlay();
      return;
    }
    toggleHold();
    return;
  }

  // Invert mode toggle
  if (e.code === 'KeyM') {
    e.preventDefault();
    toggleInvert();
    return;
  }

  // Movement keys
  const move = ALL_MOVES[e.code];
  if (move) {
    e.preventDefault();
    highlightKey(e.code, true);
    pushUndo(move.vector, move.ratio);
    currentVector = currentVector.add(move.vector);
    lastMove = move;
    updateDisplay(move.ratio);
    updateFrequencyIfSounding();
  }
}

function handleKeyUp(e) {
  if (e.target && e.target.tagName === 'TEXTAREA') return;

  recordKeyEvent(e, false);

  if (holdMode && CHORD_PRESETS[e.code]) {
    releaseHeldChord(e.code);
  } else if (holdMode && ADDITIVE_RATIOS[e.code]) {
    releaseHeldAdditive(e.code);
  } else if (!CHORD_PRESETS[e.code] && !ADDITIVE_RATIOS[e.code] && !MODE_KEYS.has(e.code)) {
    // Don't un-highlight mode keys (hum, pivot, hold stay lit)
    highlightKey(e.code, false);
  }

  if (e.code === 'Space') {
    const wasSounding = isSounding;
    stopTone();
    // A chord that just finished sounding steps the root, in pivot mode
    if (wasSounding) pivotRoot();
  }
}

document.addEventListener('keydown', handleKeyDown);
document.addEventListener('keyup', handleKeyUp);

// === Mouse Input (clicks on cheatsheet keys) ===

let mouseDownKey = null; // data-key of the legend key currently held via pointer

function fakeKeyEvent(code) {
  return { code, repeat: false, preventDefault() {} };
}

function releaseMouseKey() {
  if (!mouseDownKey) return;
  handleKeyUp(fakeKeyEvent(mouseDownKey));
  mouseDownKey = null;
}

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const keyEl = e.target.closest('.cheat-key[data-key]');
  if (!keyEl) return;
  e.preventDefault(); // no text selection while clicking keys
  mouseDownKey = keyEl.dataset.key;
  handleKeyDown(fakeKeyEvent(mouseDownKey));
});

document.addEventListener('pointerup', releaseMouseKey);
document.addEventListener('pointercancel', releaseMouseKey);

// === Session: Record & Playback ===

// The score is the instrument's own choreography: timestamped keystrokes,
// recorded from play or hand-written, and replayed by re-dispatching the
// events through the very same handlers the keyboard and cheatsheet clicks
// use. What the organ writes is what it reads.

const SCORE_STORAGE_KEY = 'prime-drifter-score';

const SCORE_HELP = '# score: bare number sets the time in seconds, "+0.25" advances it\n' +
  '# <key>+ press · <key>- release · bare <key> quick tap · sethz <hz> moves the initial root · # comment\n' +
  '# keys: space 0-5 letters ; \' , . / \\ del  (digit keys always need + or -)';

// The editor starts life as the rainbow from the song book — one source of truth.
const SCORE_SEED = (typeof SONGS !== 'undefined' && SONGS.length)
  ? (SONGS.find(s => /rainbow/i.test(s.name)) || SONGS[0]).score
  : SCORE_HELP + '\n';

let scoreEl, pbStatusEl, recBtn, playBtn, stopBtn, pbLoopEl, pbRestoreBtn, pbResetEl, pbSongsEl;
let recEvents = null;    // array of events while recording, else null
let recDownCodes = new Set(); // keys the current take has seen pressed
let discardedScore = null; // last score displaced by a recording or song load (one-slot undo)
let lastRecHz = null;      // coalescing tracker for recorded slider moves
let recStartMs = 0;
let playing = false;
let playTimers = [];
let pressedCodes = null; // codes played down by playback, not yet released
let playTotalMs = 0;
let playNowMs = 0;

function setStatus(msg) {
  pbStatusEl.textContent = msg;
}

// Brief override so events with no visible effect (like sethz to the value
// the instrument already holds) still announce themselves.
let statusFlashUntil = 0;
function setStatusFlash(msg) {
  setStatus(msg);
  statusFlashUntil = performance.now() + 800;
}

function fakeKey(code) {
  return { code, repeat: false, preventDefault() {} };
}

function recordKeyEvent(e, down) {
  if (!recEvents || playing) return;
  if (e.key === '?') return;          // the field guide is not part of the music
  if (!scoreTokenFor(e.code)) return; // only the instrument's own keys
  // A key held down before the take started has no press to release: drop
  // its orphan keyup, or the score would open with a release that tells
  // playback to let go of a note the take never attacked.
  if (down) recDownCodes.add(e.code);
  else if (!recDownCodes.delete(e.code)) return;
  recEvents.push({ t: Math.round(performance.now() - recStartMs), code: e.code, down });
}

// Slider moves are captured too (coalesced): a recording that retunes the
// instrument replays the retune. forced=true flushes the exact final value,
// but only if the slider was actually moved during the take.
function recordBaseHz(forced) {
  if (!recEvents || playing) return;
  if (forced && lastRecHz === null) return;
  if (!forced && lastRecHz !== null && Math.abs(baseHz - lastRecHz) / lastRecHz < 0.005) return;
  if (lastRecHz !== null && Math.abs(baseHz - lastRecHz) < 1e-9) return;
  lastRecHz = baseHz;
  recEvents.push({ t: Math.round(performance.now() - recStartMs), type: 'sethz', hz: baseHz });
}

function startRecording() {
  stopPlayback();
  recStartMs = performance.now();
  recEvents = [];
  recDownCodes.clear();
  lastRecHz = null;
  recBtn.classList.add('recording');
  recBtn.textContent = '■ stop';
}

function stopRecording() {
  if (!recEvents) return;
  recordBaseHz(true); // exact final slider position
  const events = recEvents;
  recEvents = null;
  recBtn.classList.remove('recording');
  recBtn.textContent = '● rec';
  writeScore(events);
  setStatus(`recorded ${events.length} events — edit the score, press play`);
}

// Replace the score body with a recording, keeping any leading comment header.
// A recording of nothing never touches the score; a recording that displaces a
// non-empty score keeps it one click away via the restore button.
function writeScore(events) {
  if (events.length === 0) {
    setStatus('nothing recorded — score untouched');
    return;
  }
  const previous = scoreEl.value;
  const header = [];
  for (const line of previous.split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) header.push(line);
    else break;
  }
  scoreEl.value = `${header.join('\n').trim() || SCORE_HELP}\n\n${formatScore(events)}`;
  if (parseScore(previous).events.length > 0) {
    discardedScore = previous;
    pbRestoreBtn.hidden = false;
  }
  saveScore();
}

// Load a built-in song into the editor. Like recording, it never silently
// destroys: a playable score it displaces stays one click away via restore.
function loadSong(i) {
  const song = SONGS[i];
  if (!song) return;
  const previous = scoreEl.value;
  if (previous.trim() !== song.score.trim() && parseScore(previous).events.length > 0) {
    discardedScore = previous;
    pbRestoreBtn.hidden = false;
  }
  scoreEl.value = song.score;
  saveScore();
  setStatus(`“${song.name}” loaded — press play`);
}

// Snap the instrument back to defaults so a pass starts where the score
// assumes it starts: home root, nothing voiced, no modes engaged.
function resetInstrument() {
  if (!currentVector.isZero()) {
    pushUndo(currentVector.negate(), 'reset');
    currentVector = new PrimeVector(0, 0, 0, 0);
    lastMove = null;
    updateDisplay('reset');
  }
  if (activeChord || activeAdditives.size > 0) clearVoicing();
  if (humNodes) toggleHum();
  if (pivotMode) togglePivot();
  if (holdMode) toggleHold();
  if (invertedMode) toggleInvert();
  updateFrequencyIfSounding();
  setStatusFlash('reset — root home, voicing and modes clear');
}

function startPlayback() {
  if (recEvents) stopRecording();
  stopPlayback();
  const { events, errors } = parseScore(scoreEl.value);
  if (errors.length) {
    setStatus(`score error — ${errors[0].msg} (line ${errors[0].line})`);
    return;
  }
  if (events.length === 0) {
    setStatus('nothing to play');
    return;
  }
  if (pbResetEl.checked) resetInstrument();
  playing = true;
  pressedCodes = new Set();
  playTotalMs = events[events.length - 1].t;
  playNowMs = 0;
  playBtn.classList.add('playing');
  playBtn.textContent = '▶ playing';
  saveScore();
  events.forEach((ev, i) => {
    playTimers.push(setTimeout(() => {
      dispatchScoreEvent(ev);
      if (i === events.length - 1) finishPlayback();
    }, ev.t));
  });
}

function dispatchScoreEvent(ev) {
  playNowMs = ev.t;
  if (ev.type === 'sethz') {
    setBaseHz(ev.hz);
    setStatusFlash(`sethz → ${ev.hz.toFixed(1)} Hz ≈ ${approxNoteName(ev.hz)}`);
    return;
  }
  if (ev.down) {
    pressedCodes.add(ev.code);
    handleKeyDown(fakeKey(ev.code));
  } else {
    pressedCodes.delete(ev.code);
    handleKeyUp(fakeKey(ev.code));
  }
}

function finishPlayback() {
  playing = false;
  playTimers = [];
  pressedCodes = null;
  playBtn.classList.remove('playing');
  playBtn.textContent = '▶ play';
  clearStaleHighlights();
  setStatus('played');
  if (pbLoopEl.checked) startPlayback();
}

// Manual stop: kill pending events, let go of everything playback held, silence.
function stopPlayback() {
  playTimers.forEach(clearTimeout);
  playTimers = [];
  const wasPlaying = playing;
  playing = false;
  playBtn.classList.remove('playing');
  playBtn.textContent = '▶ play';
  if (!wasPlaying) return;
  if (pressedCodes) {
    for (const code of pressedCodes) handleKeyUp(fakeKey(code));
    pressedCodes = null;
  }
  if (isSounding) handleKeyUp(fakeKey('Space'));
  if (activeChord || activeAdditives.size > 0) {
    clearVoicing();
    updateDisplay();
    updateFrequencyIfSounding();
  }
  clearStaleHighlights();
  setStatus('stopped');
}

function clearStaleHighlights() {
  for (const el of document.querySelectorAll('.cheat-key.active')) {
    const code = el.dataset.key;
    if (MODE_KEYS.has(code) || code === activeChord || activeAdditives.has(code)) continue;
    el.classList.remove('active');
  }
}

function saveScore() {
  try { localStorage.setItem(SCORE_STORAGE_KEY, scoreEl.value); } catch (err) { /* private mode */ }
}

// Called from the animation loop so counters tick live.
function updateSessionStatus() {
  if (!pbStatusEl) return;
  if (performance.now() < statusFlashUntil) return;
  if (recEvents) {
    setStatus(`● ${((performance.now() - recStartMs) / 1000).toFixed(1)}s · ${recEvents.length} events`);
  } else if (playing) {
    setStatus(`▶ ${(playNowMs / 1000).toFixed(1)} / ${(playTotalMs / 1000).toFixed(1)}s`);
  }
}

function setupSessionControls() {
  scoreEl = document.getElementById('pb-score');
  pbStatusEl = document.getElementById('pb-status');
  recBtn = document.getElementById('pb-rec');
  playBtn = document.getElementById('pb-play');
  stopBtn = document.getElementById('pb-stop');
  pbLoopEl = document.getElementById('pb-loop');
  pbRestoreBtn = document.getElementById('pb-restore');
  pbResetEl = document.getElementById('pb-reset');

  let saved = null;
  try { saved = localStorage.getItem(SCORE_STORAGE_KEY); } catch (err) { /* private mode */ }
  // Fall back to the example whenever the saved score has nothing playable —
  // this doubles as the way to bring the example back: clear the editor, reload.
  scoreEl.value = saved && parseScore(saved).events.length > 0 ? saved : SCORE_SEED;

  scoreEl.addEventListener('input', saveScore);
  recBtn.addEventListener('click', () => (recEvents ? stopRecording() : startRecording()));
  playBtn.addEventListener('click', () => (playing ? stopPlayback() : startPlayback()));
  stopBtn.addEventListener('click', () => { stopRecording(); stopPlayback(); });
  pbRestoreBtn.addEventListener('click', () => {
    if (discardedScore === null) return;
    scoreEl.value = discardedScore;
    discardedScore = null;
    pbRestoreBtn.hidden = true;
    saveScore();
    setStatus('previous score restored');
  });

  // Song picker: built-in tunes, each verified pure by the test suite.
  pbSongsEl = document.getElementById('pb-songs');
  for (const [i, song] of SONGS.entries()) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = song.name;
    pbSongsEl.appendChild(opt);
  }
  pbSongsEl.addEventListener('change', () => loadSong(parseInt(pbSongsEl.value, 10)));
}

// === Safety Nets ===

// An inactive tab or window never receives keyup: a manually held space
// would ring forever with its key stuck lit. When focus leaves us, let go
// of everything — WITHOUT pivoting: tabbing away is not a musical release,
// so the root should not move just because you switched apps.
function releaseEverything() {
  stopPlayback();
  if (isSounding) {
    stopTone();
    highlightKey('Space', false);
  }
}

function setupSafetyNets() {
  // Background tabs throttle timers; don't let a hidden tab avalanche on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseEverything();
  });
  // ⌘Tab keeps the page technically visible, yet keyup never arrives.
  window.addEventListener('blur', releaseEverything);
}

// === Init ===

setupSliders();
setupRootControl();
setupBodyControl();
setupVolumeControl();
setupSessionControls();
setupSafetyNets();
console.log('prime drifter organ — build: step 16 polish');
window.__pdrRev = 6; // engine fingerprint for pop-probe (warm-cache + silent-born + grow + align + chiff-kill)
window.__pdrChiff = 'killed'; // chiff absent from graph unless window.chiffOn === true
updateDisplay();
requestAnimationFrame(overtoneLoop);
