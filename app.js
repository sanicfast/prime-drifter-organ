// Prime Drifter Organ — Main app

// === App State ===

const ROOT_HZ_LOW = 55;   // slider bounds for the initial root
const ROOT_HZ_HIGH = 880;
let baseHz = 264;         // where vector [0,0,0,0] lives (default C4 = 264 Hz) — also the hum's pitch
const VOLUME = 0.3;
const HUM_VOLUME = 0.05;
const HUM_FADE = 0.4;
const QUICK_FADE = 0.01; // fast dip to silence before re-attacking, kills click from hard stops
const VOICE_FADE = 0.06; // crossfade time for voices joining/leaving a held chord

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
let masterGain = null;
let noiseBuffer = null;
let voices = []; // active voice group (array of voice objects)
let releasing = new Set(); // voice groups still fading out from a previous note
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
  masterGain.gain.value = 0;
  masterGain.connect(audioCtx.destination);

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
function addHarmonics(freq, dest) {
  const partials = [];
  for (const { mult, mix } of PARTIAL_MIX) {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    const gain = audioCtx.createGain();
    gain.gain.value = mix * body;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    partials.push({ osc, gain, mult, mix });
  }
  return partials;
}

function createVoice(freq, key) {
  const now = audioCtx.currentTime;
  const nodes = [];

  // Per-voice gain: lets a single voice fade in/out while the note is held
  const voiceGain = audioCtx.createGain();
  voiceGain.gain.value = 1;
  voiceGain.connect(masterGain);
  nodes.push(voiceGain);

  // Fundamental
  const osc1 = audioCtx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = freq;
  const gain1 = audioCtx.createGain();
  gain1.gain.value = 1.0;
  osc1.connect(gain1);
  gain1.connect(voiceGain);
  osc1.start();
  nodes.push(osc1, gain1);

  // Octave partial
  const osc2 = audioCtx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;
  const gain2 = audioCtx.createGain();
  gain2.gain.value = 0.12;
  osc2.connect(gain2);
  gain2.connect(voiceGain);
  osc2.start();
  nodes.push(osc2, gain2);

  // Upper harmonic stack (glides with the fundamental, retunes with body)
  const partials = addHarmonics(freq, voiceGain);
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
  noiseGain.gain.value = 0.04;
  noiseSrc.connect(bpFilter);
  bpFilter.connect(noiseGain);
  noiseGain.connect(voiceGain);
  noiseSrc.start();
  nodes.push(noiseSrc, bpFilter, noiseGain);

  // Chiff
  const chiffSrc = audioCtx.createBufferSource();
  chiffSrc.buffer = noiseBuffer;
  chiffSrc.loop = true;
  const chiffFilter = audioCtx.createBiquadFilter();
  chiffFilter.type = 'highpass';
  chiffFilter.frequency.value = freq * 2.5;
  const chiffGain = audioCtx.createGain();
  chiffGain.gain.setValueAtTime(0.12, now);
  chiffGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  chiffSrc.connect(chiffFilter);
  chiffFilter.connect(chiffGain);
  chiffGain.connect(voiceGain);
  chiffSrc.start();
  chiffSrc.stop(now + 0.08);
  nodes.push(chiffSrc, chiffFilter, chiffGain);

  return {
    oscs: [osc1, osc2, ...partials.map(p => p.osc)],
    extra: [noiseSrc, chiffSrc],
    nodes, voiceGain, partials, freq, key,
  };
}

function destroyVoice(v) {
  for (const node of v.nodes) {
    try { node.disconnect(); } catch(e) {}
  }
}

function stopVoicesAt(voiceList, when) {
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
    releasing.delete(voiceList);
  }, ms);
}

function releaseVoices(voiceList, fadeTime) {
  const now = audioCtx.currentTime;
  const g = masterGain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(0, now + fadeTime);
  stopVoicesAt(voiceList, now + fadeTime);
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
  const g = masterGain.gain;

  // Steal any voices still fading out from a previous note: ramping the
  // shared master gain back up would make them audible again until their
  // scheduled stop — a hard stop at audible gain clicks.
  if (voices.length > 0) releasing.add(voices);
  voices = [];
  for (const fading of [...releasing]) {
    stopVoicesAt(fading, now + QUICK_FADE);
  }

  // ADSR on master gain: quick dip to silence (kills any stolen voices),
  // then attack/decay from the current gain value — never a hard jump.
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(0, now + QUICK_FADE);
  g.linearRampToValueAtTime(perVoiceVolume, now + QUICK_FADE + envelope.attack);
  g.linearRampToValueAtTime(perVoiceVolume * envelope.sustain,
    now + QUICK_FADE + envelope.attack + envelope.decay);

  voices = voicing.map(s => createVoice(s.freq, s.key));

  isSounding = true;
  stateDisplay.textContent = 'sounding';
  stateDisplay.classList.add('sounding');
}

function stopTone() {
  if (!isSounding) return;

  releaseVoices(voices, envelope.release);
  voices = [];
  isSounding = false;
  stateDisplay.textContent = 'idle';
  stateDisplay.classList.remove('sounding');
}

function updateFrequencyIfSounding() {
  if (!isSounding) return;

  const voicing = getChordVoicing();
  const now = audioCtx.currentTime;
  const want = new Map(voicing.map(s => [s.key, s.freq]));

  // Diff voices by prime vector, not by hz: shared ratios keep sounding
  // untouched (no re-attack, no click); only changed voices crossfade.
  const kept = [];
  const dying = [];
  for (const v of voices) {
    if (want.has(v.key)) kept.push({ voice: v, freq: want.get(v.key) });
    else dying.push(v);
  }

  for (const v of dying) {
    const vg = v.voiceGain.gain;
    vg.cancelScheduledValues(now);
    vg.setValueAtTime(vg.value, now);
    vg.linearRampToValueAtTime(0, now + VOICE_FADE);
  }
  if (dying.length > 0) stopVoicesAt(dying, now + VOICE_FADE);

  const haveKeys = new Set(kept.map(k => k.voice.key));
  const added = [];
  for (const s of voicing) {
    if (haveKeys.has(s.key)) continue;
    const v = createVoice(s.freq, s.key);
    const vg = v.voiceGain.gain;
    vg.setValueAtTime(0, now);
    vg.linearRampToValueAtTime(1, now + Math.max(envelope.attack, VOICE_FADE));
    added.push({ voice: v, freq: s.freq });
  }

  voices = kept.concat(added).map(k => k.voice);

  // Keep total loudness steady as the voice count changes
  if (dying.length > 0 || added.length > 0) {
    const level = (VOLUME / voices.length) * envelope.sustain;
    const g = masterGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(level, now + VOICE_FADE);
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

// === Tonic Hum ===

function startHum() {
  if (humNodes) return;
  initAudio();

  const freq = foldToAudible(baseHz);
  const now = audioCtx.currentTime;

  // Independent chain: never touches masterGain, so it's unaffected by the note envelope
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(HUM_VOLUME, now + HUM_FADE);
  gain.connect(audioCtx.destination);

  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  osc.start();

  // Subtle octave partial for a little body, like the main voice
  const osc2 = audioCtx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;
  const gain2 = audioCtx.createGain();
  gain2.gain.value = 0.12;
  osc2.connect(gain2);
  gain2.connect(gain);
  osc2.start();

  // The drone gets the harmonic stack too: it becomes a full tuning fork
  const partials = addHarmonics(freq, gain);

  humNodes = { oscs: [osc, osc2, ...partials.map(p => p.osc)], gains: [gain, gain2], partials };
  setHumActive(true);
}

function stopHum() {
  if (!humNodes) return;

  const now = audioCtx.currentTime;
  const g = humNodes.gains[0].gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(0, now + HUM_FADE);

  const dying = humNodes;
  humNodes = null;
  for (const osc of dying.oscs) { try { osc.stop(now + HUM_FADE + 0.01); } catch(e) {} }
  setTimeout(() => {
    for (const node of dying.gains) { try { node.disconnect(); } catch(e) {} }
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
    updateFrequencyIfSounding();
    return;
  }

  const outerVoice = voices.find(v => v.key === vectorKey(farthest));
  if (outerVoice) outerVoice.key = ROOT_KEY; // relabel before the voice diff so it survives

  const label = pivotLabel(farthest);
  pushUndo(farthest, label);
  currentVector = currentVector.add(farthest);

  clearVoicing();
  updateDisplay(label);
  updateFrequencyIfSounding();
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

const SCORE_SEED = SCORE_HELP + '\n\n' +
  '# "Somewhere, over the rainbow" — the opening, anchored on do\n' +
  '0.00 sethz 264    # pin the key to C4, whatever the slider says\n' +
  '0.00 .            # hum on: the drone is the tonic\n' +
  '0.00 space+\n' +
  '0.55 1+           # "Some—where" — that octave, gliding\n' +
  '1.15 g+           # "there\'s"   ti  15:8\n' +
  '1.75 b+           # "a place"   la  5:3\n' +
  '2.35 v+           # "I heard"   sol 3:2\n' +
  '2.95 b+           # "of"        fa  4:3\n' +
  '3.55 g+           # "a"         mi  5:4\n' +
  '4.40 1-\n' +
  '4.45 space-\n' +
  '4.55 .            # hum off\n';

let scoreEl, pbStatusEl, recBtn, playBtn, stopBtn, pbLoopEl, pbRestoreBtn, pbResetEl;
let recEvents = null;    // array of events while recording, else null
let discardedScore = null; // last score displaced by a recording (one-slot undo)
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

function fakeKey(code) {
  return { code, repeat: false, preventDefault() {} };
}

function recordKeyEvent(e, down) {
  if (!recEvents || playing) return;
  if (e.key === '?') return;          // the field guide is not part of the music
  if (!scoreTokenFor(e.code)) return; // only the instrument's own keys
  recEvents.push({ t: Math.round(performance.now() - recStartMs), code: e.code, down });
}

// Slider moves are captured too (coalesced): a recording that retunes the
// instrument replays the retune. forced=true flushes the exact final value.
function recordBaseHz(forced) {
  if (!recEvents || playing) return;
  if (!forced && lastRecHz !== null && Math.abs(baseHz - lastRecHz) / lastRecHz < 0.005) return;
  if (lastRecHz !== null && Math.abs(baseHz - lastRecHz) < 1e-9) return;
  lastRecHz = baseHz;
  recEvents.push({ t: Math.round(performance.now() - recStartMs), type: 'sethz', hz: baseHz });
}

function startRecording() {
  stopPlayback();
  recStartMs = performance.now();
  recEvents = [];
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

  // Background tabs throttle timers; don't let a hidden tab avalanche on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPlayback();
  });
}

// === Init ===

setupSliders();
setupRootControl();
setupBodyControl();
setupSessionControls();
console.log('prime drifter organ — build: scores with sethz (e765474)');
updateDisplay();
requestAnimationFrame(overtoneLoop);
