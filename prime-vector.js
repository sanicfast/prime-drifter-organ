// Prime Drifter Organ — Core math module

// === Prime Vector ===

class PrimeVector {
  constructor(e2 = 0, e3 = 0, e5 = 0, e7 = 0) {
    this.exp = [e2, e3, e5, e7];
  }

  add(other) {
    return new PrimeVector(
      this.exp[0] + other.exp[0],
      this.exp[1] + other.exp[1],
      this.exp[2] + other.exp[2],
      this.exp[3] + other.exp[3]
    );
  }

  negate() {
    return new PrimeVector(...this.exp.map(e => -e));
  }

  isZero() {
    return this.exp.every(e => e === 0);
  }

  equals(other) {
    return this.exp.every((e, i) => e === other.exp[i]);
  }

  toFrequency(baseHz) {
    return baseHz
      * Math.pow(2, this.exp[0])
      * Math.pow(3, this.exp[1])
      * Math.pow(5, this.exp[2])
      * Math.pow(7, this.exp[3]);
  }

  toString() {
    return `[${this.exp.join(', ')}]`;
  }
}

// === Octave Folding ===

const FOLD_LOW = 55;
const FOLD_HIGH = 1760;

function foldToAudible(freq) {
  let f = freq;
  while (f < FOLD_LOW) f *= 2;
  while (f > FOLD_HIGH) f /= 2;
  return f;
}

// === Movement Vectors ===

// Big moves — number row (up) / bottom row (down)
const MOVES_BIG = {
  'Digit1': { ratio: '2:1', vector: new PrimeVector(1, 0, 0, 0) },
  'Digit2': { ratio: '3:1', vector: new PrimeVector(0, 1, 0, 0) },
  'Digit3': { ratio: '12:5', vector: new PrimeVector(2, 1, -1, 0) },
  'Digit4': { ratio: '7:4', vector: new PrimeVector(-2, 0, 0, 1) },
  'Digit5': { ratio: '9:8', vector: new PrimeVector(-3, 2, 0, 0) },
  'KeyZ': { ratio: '1:2', vector: new PrimeVector(-1, 0, 0, 0) },
  'KeyX': { ratio: '1:3', vector: new PrimeVector(0, -1, 0, 0) },
  'KeyC': { ratio: '5:12', vector: new PrimeVector(-2, -1, 1, 0) },
  'KeyV': { ratio: '4:7', vector: new PrimeVector(2, 0, 0, -1) },
  'KeyB': { ratio: '8:9', vector: new PrimeVector(3, -2, 0, 0) },
};

// Small moves — top row (up) / home row (down)
const MOVES_SMALL = {
  'KeyQ': { ratio: '3:2', vector: new PrimeVector(-1, 1, 0, 0) },
  'KeyW': { ratio: '4:3', vector: new PrimeVector(2, -1, 0, 0) },
  'KeyE': { ratio: '5:4', vector: new PrimeVector(-2, 0, 1, 0) },
  'KeyR': { ratio: '6:5', vector: new PrimeVector(1, 1, -1, 0) },
  'KeyT': { ratio: '16:15', vector: new PrimeVector(4, -1, -1, 0) },
  'KeyA': { ratio: '2:3', vector: new PrimeVector(1, -1, 0, 0) },
  'KeyS': { ratio: '3:4', vector: new PrimeVector(-2, 1, 0, 0) },
  'KeyD': { ratio: '4:5', vector: new PrimeVector(2, 0, -1, 0) },
  'KeyF': { ratio: '5:6', vector: new PrimeVector(-1, -1, 1, 0) },
  'KeyG': { ratio: '15:16', vector: new PrimeVector(-4, 1, 1, 0) },
};

const ALL_MOVES = { ...MOVES_BIG, ...MOVES_SMALL };

// === Chord Presets ===
// Each preset is an array of PrimeVector multipliers relative to root.

const CHORD_PRESETS = {
  'KeyH': {
    name: 'Major Triad',
    voices: [
      new PrimeVector(0, 0, 0, 0),   // 1
      new PrimeVector(-2, 0, 1, 0),  // 5/4
      new PrimeVector(-1, 1, 0, 0),  // 3/2
    ]
  },
  'KeyJ': {
    name: 'Minor Triad',
    voices: [
      new PrimeVector(0, 0, 0, 0),   // 1
      new PrimeVector(1, 1, -1, 0),  // 6/5
      new PrimeVector(-1, 1, 0, 0),  // 3/2
    ]
  },
  'KeyK': {
    name: 'Harmonic 7th',
    voices: [
      new PrimeVector(0, 0, 0, 0),   // 1
      new PrimeVector(-2, 0, 1, 0),  // 5/4
      new PrimeVector(-1, 1, 0, 0),  // 3/2
      new PrimeVector(-2, 0, 0, 1),  // 7/4
    ]
  },
  'KeyL': {
    name: 'Sus4',
    voices: [
      new PrimeVector(0, 0, 0, 0),   // 1
      new PrimeVector(2, -1, 0, 0),  // 4/3
      new PrimeVector(-1, 1, 0, 0),  // 3/2
    ]
  },
  'Semicolon': {
    name: 'Wide Triad',
    voices: [
      new PrimeVector(0, 0, 0, 0),   // 1
      new PrimeVector(-2, 0, 1, 0),  // 5/4
      new PrimeVector(-1, 1, 0, 0),  // 3/2
      new PrimeVector(1, 0, 0, 0),   // 2
    ]
  },
  'Quote': {
    name: 'Open Tenth',
    voices: [
      new PrimeVector(0, 0, 0, 0),   // 1
      new PrimeVector(-1, 1, 0, 0),  // 3/2
      new PrimeVector(-1, 0, 1, 0),  // 5/2
    ]
  },
};

// === Additive Ratios (top row right hand) ===
// These toggle on/off, non-exclusive. XOR with chord voices.

const ADDITIVE_RATIOS = {
  'KeyY': { ratio: '9:8', vector: new PrimeVector(-3, 2, 0, 0) },
  'KeyU': { ratio: '5:4', vector: new PrimeVector(-2, 0, 1, 0) },
  'KeyI': { ratio: '4:3', vector: new PrimeVector(2, -1, 0, 0) },
  'KeyO': { ratio: '3:2', vector: new PrimeVector(-1, 1, 0, 0) },
  'KeyP': { ratio: '7:4', vector: new PrimeVector(-2, 0, 0, 1) },
};

// === Voice Ratio Labels ===
// Human-readable names for chord/additive voices, keyed by vectorKey().
// Includes reciprocals for invert mode.

const VOICE_LABELS = {
  '0,0,0,0': '1:1',
  '-3,2,0,0': '9:8',
  '-2,0,1,0': '5:4',
  '1,1,-1,0': '6:5',
  '2,-1,0,0': '4:3',
  '-1,1,0,0': '3:2',
  '-2,0,0,1': '7:4',
  '1,0,0,0': '2:1',
  '-1,0,1,0': '5:2',
  '3,-2,0,0': '8:9',
  '2,0,-1,0': '4:5',
  '-1,-1,1,0': '5:6',
  '-2,1,0,0': '3:4',
  '1,-1,0,0': '2:3',
  '2,0,0,-1': '4:7',
  '-1,0,0,0': '1:2',
  '1,0,-1,0': '2:5',
};
