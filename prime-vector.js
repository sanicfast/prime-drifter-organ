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
  'Digit3': { ratio: '7:4', vector: new PrimeVector(-2, 0, 0, 1) },
  'Digit4': { ratio: '10:9', vector: new PrimeVector(1, -2, 1, 0) },
  'Digit5': { ratio: '9:8', vector: new PrimeVector(-3, 2, 0, 0) },
  'KeyZ': { ratio: '1:2', vector: new PrimeVector(-1, 0, 0, 0) },
  'KeyX': { ratio: '1:3', vector: new PrimeVector(0, -1, 0, 0) },
  'KeyC': { ratio: '4:7', vector: new PrimeVector(2, 0, 0, -1) },
  'KeyV': { ratio: '9:10', vector: new PrimeVector(-1, 2, -1, 0) },
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

// === Score Format ===
// The instrument's native notation is its own keystroke choreography: a list
// of timestamped key presses and releases. Recorded and hand-written scores
// share this format, and playback just replays events through the key
// handlers — so the organ "reads" exactly what it "writes". Pure string
// handling lives here so it stays testable without a browser.
//
// Line format:  <time> <token><+|->        time: seconds, or +delta
//               bare token = quick tap (press + release)
//               <time> sethz <hz>  move the initial root
//               '#' anywhere on a line starts a comment
//
//   0.00 space+ 0        hold space, snap home
//   0.45 1               glide up an octave ("Some—where")
//   1.05 g               ti, a pure 15:16 down
//   4.35 space-
//
// Note: bare numbers are times, so the 0-5 keys always need a +/- suffix.

const TAP_GAP_MS = 30; // bare token: press, then release after this gap

// Friendly token for every playable key code (built from the tables above).
const SCORE_TOKENS = (() => {
  const codes = new Set([
    'Space', 'Digit0', 'Backspace', 'Backslash',
    'Period', 'Comma', 'Slash', 'KeyM', 'KeyN',
    ...Object.keys(MOVES_BIG), ...Object.keys(MOVES_SMALL),
    ...Object.keys(CHORD_PRESETS), ...Object.keys(ADDITIVE_RATIOS),
  ]);
  const special = {
    'Space': 'space', 'Semicolon': ';', 'Quote': "'", 'Comma': ',',
    'Period': '.', 'Slash': '/', 'Backslash': '\\', 'Backspace': 'del',
  };
  const tokens = {};
  for (const code of codes) {
    tokens[code] = special[code]
      || (code.startsWith('Digit') ? code.slice(5) : code.slice(3).toLowerCase());
  }
  return tokens;
})();

const SCORE_CODES = Object.fromEntries(
  Object.entries(SCORE_TOKENS).map(([code, tok]) => [tok, code])
);

function scoreTokenFor(code) {
  return SCORE_TOKENS[code] || null;
}

// Resolve a score token to a key code; also accepts raw codes, case-free.
function resolveScoreCode(token) {
  if (SCORE_CODES[token]) return SCORE_CODES[token];
  const raw = token.toLowerCase();
  for (const code of Object.keys(SCORE_TOKENS)) {
    if (code.toLowerCase() === raw) return code;
  }
  return null;
}

function parseScore(text) {
  const events = [];
  const errors = [];
  let curT = 0; // ms, persists across lines until re-anchored
  const lines = String(text).split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const tokens = lines[i].split('#')[0].trim().split(/\s+/).filter(Boolean);
    for (let ti = 0; ti < tokens.length; ti++) {
      const tok = tokens[ti];
      if (tok === 'sethz') {
        // strict: parseFloat alone would happily turn "264abc" into 264
        const arg = tokens[++ti];
        const hz = /^\d+(\.\d+)?$/.test(arg || '') ? parseFloat(arg) : NaN;
        if (!Number.isFinite(hz) || hz <= 0) {
          errors.push({ line: lineNo, msg: 'sethz needs a positive hz argument' });
          continue;
        }
        events.push({ t: curT, type: 'sethz', hz, line: lineNo });
        continue;
      }
      if (/^\d+(\.\d+)?$/.test(tok) || /^\.\d+$/.test(tok)) {
        curT = Math.round(parseFloat(tok) * 1000);
        continue;
      }
      if (/^\+\d*\.?\d+$/.test(tok)) {
        curT += Math.round(parseFloat(tok.slice(1)) * 1000);
        continue;
      }
      const last = tok[tok.length - 1];
      let down = null;
      if (last === '+') down = true;
      else if (last === '-') down = false;
      const code = last === '+' || last === '-'
        ? resolveScoreCode(tok.slice(0, -1))
        : resolveScoreCode(tok);
      if (!code) {
        errors.push({ line: lineNo, msg: `unknown token "${tok}"` });
        continue;
      }
      if (down === null) { // tap: press now, release a beat later
        events.push({ t: curT, code, down: true, line: lineNo });
        events.push({ t: curT + TAP_GAP_MS, code, down: false, line: lineNo });
      } else {
        events.push({ t: curT, code, down, line: lineNo });
      }
    }
  }
  events.sort((a, b) => a.t - b.t); // sort is stable: simultaneous events keep order
  return { events, errors };
}

function formatScore(events) {
  return events
    .map(ev => {
      const t = (ev.t / 1000).toFixed(2);
      if (ev.type === 'sethz') return `${t} sethz ${+ev.hz.toFixed(3)}`; // + trims zeros
      return `${t} ${scoreTokenFor(ev.code)}${ev.down ? '+' : '-'}`;
    })
    .join('\n');
}


// === Song Book ===
// Built-in tunes in score format, verified pure: the drift vector of every
// song only ever visits exact 5-limit scale degrees (regression-tested).
// Add songs in this shape and the tests will grade them.

const SONGS = [
  {
    name: "Twinkle, twinkle — pure steps",
    score: `# twinkle — one octave, six degrees, every step the pure one:
# q sol · 4 up small tone · v down small tone · b down big tone · g down semitone
# steps chosen so each note rings pure against the drone — enable loop to vary it

0.00 sethz 264
0.01 .+
0.04 .-
0.25 space+
0.64 space-
0.69 space+
1.08 space-
1.11 q+
1.13 space+
1.14 q-
1.52 space-
1.57 space+
1.96 space-
1.99 4+
2.01 space+
2.02 4-
2.40 space-
2.45 space+
2.84 space-
2.87 v+
2.89 space+
2.90 v-
3.84 space-
3.87 b+
3.89 space+
3.90 b-
4.28 space-
4.33 space+
4.72 space-
4.75 g+
4.77 space+
4.78 g-
5.16 space-
5.21 space+
5.60 space-
5.63 v+
5.65 space+
5.66 v-
6.04 space-
6.09 space+
6.48 space-
6.51 b+
6.53 space+
6.54 b-
7.48 space-
7.51 q+
7.53 space+
7.54 q-
7.92 space-
7.97 space+
8.36 space-
8.39 b+
8.41 space+
8.42 b-
8.80 space-
8.85 space+
9.24 space-
9.27 g+
9.29 space+
9.30 g-
9.68 space-
9.73 space+
10.12 space-
10.15 v+
10.17 space+
10.18 v-
11.00 space-
11.03 w+
11.05 space+
11.06 w-
11.44 space-
11.49 space+
11.88 space-
11.91 b+
11.93 space+
11.94 b-
12.32 space-
12.37 space+
12.76 space-
12.79 g+
12.81 space+
12.82 g-
13.20 space-
13.25 space+
13.64 space-
13.67 v+
13.69 space+
13.70 v-
14.52 space-
14.55 b+
14.57 space+
14.58 b-
14.96 space-
15.01 space+
15.40 space-
15.43 q+
15.45 space+
15.46 q-
15.84 space-
15.89 space+
16.28 space-
16.31 4+
16.33 space+
16.34 4-
16.72 space-
16.77 space+
17.16 space-
17.19 v+
17.21 space+
17.22 v-
18.16 space-
18.19 b+
18.21 space+
18.22 b-
18.60 space-
18.65 space+
19.04 space-
19.07 g+
19.09 space+
19.10 g-
19.48 space-
19.53 space+
19.92 space-
19.95 v+
19.97 space+
19.98 v-
20.36 space-
20.41 space+
20.80 space-
20.83 b+
20.85 space+
20.86 b-
21.90 space-
22.10 .+
22.13 .-
22.25 0+
22.28 0-
`,
  },
  {
    name: "Ode to joy — theme",
    score: `# ode to joy — the whole theme is diatonic walkwork off mi:
# t = 16:15 · 5 up big tone · 4 up small tone · b/v/g down
# turn on loop for the repeats

0.00 sethz 264
0.01 .+
0.04 .-
0.23 e+
0.25 space+
0.26 e-
0.56 space-
0.61 space+
0.92 space-
0.95 t+
0.97 space+
0.98 t-
1.28 space-
1.31 5+
1.33 space+
1.34 5-
1.64 space-
1.69 space+
2.00 space-
2.03 b+
2.05 space+
2.06 b-
2.36 space-
2.39 g+
2.41 space+
2.42 g-
2.72 space-
2.75 v+
2.77 space+
2.78 v-
3.08 space-
3.11 b+
3.13 space+
3.14 b-
3.44 space-
3.49 space+
3.80 space-
3.83 5+
3.85 space+
3.86 5-
4.16 space-
4.19 4+
4.21 space+
4.22 4-
4.52 space-
4.57 space+
5.18 space-
5.21 v+
5.23 space+
5.24 v-
5.54 space-
5.59 space+
6.69 space-
6.89 .+
6.92 .-
7.04 0+
7.07 0-
`,
  },
  {
    name: "Joy — the falling octave",
    score: `# joy to the world — grab the octave and let the scale fall:
# do' then g b v b g v b — the octave in pure descending steps,
# landing on a major triad bloom over the drone

0.00 sethz 264
0.01 .+
0.04 .-
0.25 space+
0.40 1+
0.43 1-
0.65 space-
0.68 g+
0.70 space+
0.71 g-
0.97 space-
1.00 b+
1.02 space+
1.03 b-
1.29 space-
1.32 v+
1.34 space+
1.35 v-
1.61 space-
1.64 b+
1.66 space+
1.67 b-
1.93 space-
1.96 g+
1.98 space+
1.99 g-
2.25 space-
2.28 v+
2.30 space+
2.31 v-
2.57 space-
2.60 b+
2.62 space+
2.63 b-
2.92 h+
2.95 h-
3.92 space-
4.02 h+
4.05 h-
4.32 .+
4.35 .-
4.47 0+
4.50 0-
`,
  },
  {
    name: "Somewhere, over the rainbow",
    score: `# somewhere, over the rainbow — the opening, anchored on do
# one held space: the octave leaps, then g ti, b la, v sol, b fa, g mi

0.00 sethz 264
0.01 .
0.02 space+
0.55 1+
1.15 g+
1.75 b+
2.35 v+
2.95 b+
3.55 g+
4.40 1-
4.50 space-
4.60 .+
4.63 .-
4.80 0+
4.83 0-
`,
  }
];
