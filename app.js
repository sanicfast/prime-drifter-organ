// Prime Drifter Organ — Main app

// === App State ===

const BASE_HZ = 220;
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
const humIndicator = document.getElementById('hum-indicator');
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

function getChordVoicing() {
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

  return voiceVectors.map(v => ({
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

  const freq = foldToAudible(BASE_HZ);
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

function handleKeyDown(e) {
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

  // Tonic hum toggle
  if (e.code === 'Period') {
    e.preventDefault();
    toggleHum();
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
  // Don't un-highlight toggle keys (chords, additives, hum stay lit)
  if (!CHORD_PRESETS[e.code] && !ADDITIVE_RATIOS[e.code] && e.code !== 'Period') {
    highlightKey(e.code, false);
  }

  if (e.code === 'Space') {
    stopTone();
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
updateDisplay();
