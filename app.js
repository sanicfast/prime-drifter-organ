// Prime Drifter Organ — Main app

// === App State ===

const BASE_HZ = 220;
const VOLUME = 0.3;

let audioCtx = null;
let masterGain = null;
let noiseBuffer = null;
let voices = []; // active voice group (array of voice objects)
let isSounding = false;
let currentVector = new PrimeVector(0, 0, 0, 0);
let lastMove = null;
let activeChord = null; // key code of active chord preset, or null
let activeAdditives = new Set(); // set of key codes for active additive ratios

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
const stateDisplay = document.getElementById('state-display');
const moveDisplay = document.getElementById('move-display');
const chordDisplay = document.getElementById('chord-display');
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
  return foldToAudible(currentVector.toFrequency(BASE_HZ));
}

function createVoice(freq) {
  const now = audioCtx.currentTime;
  const nodes = [];

  // Fundamental
  const osc1 = audioCtx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = freq;
  const gain1 = audioCtx.createGain();
  gain1.gain.value = 1.0;
  osc1.connect(gain1);
  gain1.connect(masterGain);
  osc1.start();
  nodes.push(osc1, gain1);

  // Octave partial
  const osc2 = audioCtx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;
  const gain2 = audioCtx.createGain();
  gain2.gain.value = 0.12;
  osc2.connect(gain2);
  gain2.connect(masterGain);
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
  noiseGain.connect(masterGain);
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
  chiffGain.connect(masterGain);
  chiffSrc.start();
  chiffSrc.stop(now + 0.08);
  nodes.push(chiffSrc, chiffFilter, chiffGain);

  return { oscs: [osc1, osc2], extra: [noiseSrc, chiffSrc], nodes, freq };
}

function destroyVoice(v) {
  for (const node of v.nodes) {
    try { node.disconnect(); } catch(e) {}
  }
}

function vectorKey(v) {
  return v.exp.join(',');
}

function getChordFrequencies() {
  const rootFreq = getAudibleFreq();
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

  return voiceVectors.map(v => rootFreq * v.toFrequency(1));
}

function startTone() {
  if (isSounding) return;
  initAudio();

  const freqs = getChordFrequencies();
  const voiceCount = freqs.length;
  const perVoiceVolume = VOLUME / voiceCount;

  voices = freqs.map(f => createVoice(f));

  // ADSR on master gain
  const now = audioCtx.currentTime;
  const g = masterGain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0, now);
  g.linearRampToValueAtTime(perVoiceVolume, now + envelope.attack);
  g.linearRampToValueAtTime(perVoiceVolume * envelope.sustain, now + envelope.attack + envelope.decay);

  isSounding = true;
  stateDisplay.textContent = 'sounding';
  stateDisplay.classList.add('sounding');
}

function stopTone() {
  if (!isSounding) return;

  const now = audioCtx.currentTime;
  const g = masterGain.gain;

  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(0, now + envelope.release);

  const oldVoices = voices;
  const releaseTime = envelope.release;
  setTimeout(() => {
    for (const v of oldVoices) {
      for (const osc of v.oscs) { try { osc.stop(); } catch(e) {} }
      for (const src of v.extra) { try { src.stop(); } catch(e) {} }
      destroyVoice(v);
    }
  }, releaseTime * 1000 + 50);

  voices = [];
  isSounding = false;
  stateDisplay.textContent = 'idle';
  stateDisplay.classList.remove('sounding');
}

function updateFrequencyIfSounding() {
  if (!isSounding || voices.length === 0) return;

  const freqs = getChordFrequencies();

  // If voice count changed (chord switched while sounding), restart
  if (freqs.length !== voices.length) {
    stopTone();
    startTone();
    return;
  }

  const now = audioCtx.currentTime;
  for (let i = 0; i < voices.length; i++) {
    const freq = freqs[i];
    voices[i].oscs[0].frequency.setTargetAtTime(freq, now, 0.02);
    voices[i].oscs[1].frequency.setTargetAtTime(freq * 2, now, 0.02);
    voices[i].nodes.forEach(n => {
      if (n instanceof BiquadFilterNode && n.type === 'bandpass') {
        n.frequency.setTargetAtTime(freq, now, 0.02);
      }
    });
  }
}

// === Display ===

function updateDisplay(moveName) {
  const freq = getAudibleFreq();

  hzDisplay.textContent = `${freq.toFixed(2)} Hz`;
  for (let i = 0; i < 4; i++) {
    vecEls[i].textContent = currentVector.exp[i];
  }

  if (moveName) {
    moveDisplay.textContent = `${moveName}`;
  } else if (currentVector.isZero()) {
    moveDisplay.textContent = 'root';
  }

  // Chord display
  const parts = [];
  if (activeChord) {
    parts.push(CHORD_PRESETS[activeChord].name);
  }
  for (const code of activeAdditives) {
    parts.push(ADDITIVE_RATIOS[code].ratio);
  }
  chordDisplay.textContent = parts.length ? parts.join(' + ') : 'none';
}

// === Key Highlight ===

function highlightKey(code, on) {
  const el = document.querySelector(`.cheat-key[data-key="${code}"]`);
  if (el) el.classList.toggle('active', on);
}

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

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;

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

  // Chord presets (mutually exclusive toggle)
  if (CHORD_PRESETS[e.code]) {
    e.preventDefault();
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

  // Additive ratio toggles (non-exclusive)
  if (ADDITIVE_RATIOS[e.code]) {
    e.preventDefault();
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
    if (activeChord) {
      highlightKey(activeChord, false);
      activeChord = null;
    }
    for (const code of activeAdditives) {
      highlightKey(code, false);
    }
    activeAdditives.clear();
    updateDisplay();
    updateFrequencyIfSounding();
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
});

document.addEventListener('keyup', (e) => {
  // Don't un-highlight toggle keys (chords and additives stay lit)
  if (!CHORD_PRESETS[e.code] && !ADDITIVE_RATIOS[e.code]) {
    highlightKey(e.code, false);
  }

  if (e.code === 'Space') {
    stopTone();
  }
});

// === Init ===

setupSliders();
updateDisplay();
