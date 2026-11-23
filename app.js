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

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']; // index = midi % 12

// Nearest equal-tempered note — a courtesy label (≈), not a promise
function approxNoteName(hz) {
  const midi = 69 + Math.round(12 * Math.log2(hz / 440));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${name}${Math.floor(midi / 12) - 1}`;
}

function setupRootControl() {
  const input = document.getElementById('base-hz');
  const label = document.getElementById('base-hz-val');

  const update = () => {
    baseHz = rootHzFromSlider(parseFloat(input.value));
    label.textContent = `${baseHz.toFixed(1)} Hz ≈ ${approxNoteName(baseHz)}`;
    updateDisplay();
    updateFrequencyIfSounding(); // glides a held chord
    retuneHum();
  };

  input.addEventListener('input', update);
  update();
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

  return { oscs: [osc1, osc2], extra: [noiseSrc, chiffSrc], nodes, voiceGain, freq, key };
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
    v.nodes.forEach(n => {
      if (n instanceof BiquadFilterNode && n.type === 'bandpass') {
        n.frequency.setTargetAtTime(freq, now, 0.02);
      }
    });
    v.freq = freq;
  }
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

  humNodes = { oscs: [osc, osc2], gains: [gain, gain2] };
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
  if (e.repeat) return;

  if (e.code === 'Escape') {
    e.preventDefault();
    toggleOverlay(false);
    return;
  }

  if (e.code === 'Space') {
    e.preventDefault();
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

// === Init ===

setupSliders();
setupRootControl();
updateDisplay();
