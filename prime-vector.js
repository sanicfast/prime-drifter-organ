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

// Octave-shift an exponent vector until its ratio lies in [1, 2): a degree
// below the root (ti down = 15:16, la down = 5:6, sol down = 3:4) folds onto
// the same pitch class as its upward twin, so purity is graded by class.
function foldToOctave(exp) {
  const v = [...exp];
  let r = Math.pow(2, v[0]) * Math.pow(3, v[1]) * Math.pow(5, v[2]) * Math.pow(7, v[3]);
  while (r < 1 - 1e-9) { v[0]++; r *= 2; }
  while (r >= 2 + 1e-9) { v[0]--; r /= 2; }
  return v;
}

// The pure 5-limit scale degrees, canonical reps in [1, 2).
const SONG_DEGREES = new Set([
  '0,0,0,0', '1,0,0,0', '-3,2,0,0', '-2,0,1,0',
  '2,-1,0,0', '-1,1,0,0', '0,-1,1,0', '-3,1,1,0',
]); // do do' re mi fa sol la ti

// Every score is played by movement keys, and every movement key is a clean
// ratio — so consecutive notes are ALWAYS pure against each other. What a song
// can't control is which side of the comma its LANDINGS fall on, and where the
// drift ends up. So each song declares a kind, and the grader holds it to it:
//
//   'anchored'    every landing is a pure degree against the root (octave
//                 folded), and the drift ends home: plays with the hum,
//                 loops identically forever.
//   'round trip'  ends home, but visits off-degree landings on the way: the
//                 steps stay clean, the commas wander, the loop still ties off.
//   'drifting'    ends off home by its declared `drift` vector — that drift IS
//                 the piece: each loop pass re-centers the tune by exactly that
//                 ratio, so it slowly goes out of its own tune. Up front about
//                 it, and the reset key (0) is always there.
//
// gradeSongPurity walks a song's events the way the instrument does;
// songKindOk checks a song's declaration against the walk.
function gradeSongPurity(song) {
  const { events, errors } = parseScore(song.score);
  let vec = [0, 0, 0, 0];
  let landingsPure = true;
  let sawSpace = false;
  for (const ev of events) {
    if (ev.type === 'sethz' || !ev.down) continue;
    if (ev.code === 'Space') { sawSpace = true; continue; }
    if (ev.code === 'Digit0') { vec = [0, 0, 0, 0]; continue; }
    const move = ALL_MOVES[ev.code];
    if (!move) continue; // chords, hum etc. don't move the root
    vec = vec.map((e, i) => e + move.vector.exp[i]);
    if (!SONG_DEGREES.has(foldToOctave(vec).join(','))) landingsPure = false;
  }
  return { events, errors, net: vec, landingsPure, sawSpace };
}

function songKindOk(song, g) {
  const endsHome = g.net.every(e => e === 0);
  switch (song.kind) {
    case 'anchored':   return g.landingsPure && endsHome;
    case 'round trip': return !g.landingsPure && endsHome;
    case 'drifting':   return !endsHome && Array.isArray(song.drift)
                         && song.drift.length === 4
                         && song.drift.join(',') === g.net.join(',');
    default:           return false; // undeclared or unknown kind: not upfront
  }
}

function ratioString(exp) {
  let num = 1, den = 1;
  [2, 3, 5, 7].forEach((p, i) => {
    const e = exp[i] || 0;
    if (e >= 0) num *= Math.pow(p, e); else den *= Math.pow(p, -e);
  });
  return `${num}:${den}`;
}

function driftCents(exp) {
  const r = [2, 3, 5, 7].reduce((acc, p, i) => acc * Math.pow(p, exp[i] || 0), 1);
  return Math.round(1200 * Math.log2(r) * 10) / 10;
}

// The honest label: shown on the song picker and spoken when a song loads.
function kindBadge(song) {
  switch (song.kind) {
    case 'anchored':   return 'pure steps';
    case 'round trip': return 'round trip';
    case 'drifting': {
      const c = driftCents(song.drift || [0, 0, 0, 0]);
      return `drifts ${c >= 0 ? '+' : ''}${c}\u00A2/loop`;
    }
    default: return 'kind?';
  }
}

function songKindNote(song) {
  switch (song.kind) {
    case 'anchored':   return 'anchored — every landing pure against the root, ends home, loops identical';
    case 'round trip': return 'round trip — clean steps that wander off-degree, but walks home; loops identical';
    case 'drifting': {
      const c = driftCents(song.drift || [0, 0, 0, 0]);
      return `drifting — each loop re-centers the tune by ${ratioString(song.drift || [0, 0, 0, 0])} (${c >= 0 ? '+' : ''}${c}\u00A2); press 0 to bring the root home`;
    }
    default: return 'kind undeclared';
  }
}

const SONGS = [
  {
    name: "Twinkle, twinkle — pure steps",
    kind: 'anchored',
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
    kind: 'anchored',
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
    kind: 'anchored',
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
    kind: 'anchored',
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
  },
  {
    name: "Saria's Song — pure steps",
    kind: 'anchored',
    score: `# saria's song (ocarina of time) — the real tune, in C, root = do
# F=fa A=la B=ti E=mi D=re G=sol, the tune's high C = do'
# two-step gaps glide through silent pure waypoints on the way off the note:
# ti->fa steps do' (t,a) · re->ti steps mi (4,q) · every landing is graded pure
# repeat ends the same D E G E turnaround, final E held longer — then 0 snaps home

0.00 sethz 264
0.01 .
0.12  w+  space+  w-
0.72  space-  e+  space+  e-
1.32  space-  5+  space+  5-
2.52  space-  t+ a+  space+  t- a-
3.12  space-  e+  space+  e-
3.72  space-  5+  space+  5-
4.92  space-  t+ a+  space+  t- a-
5.52  space-  e+  space+  e-
6.12  space-  5+  space+  5-
6.72  space-  a+  space+  a-
7.32  space-  v+  space+  v-
8.52  space-  4+ q+  space+  4- q-
9.12  space-  t+  space+  t-
9.72  space-  g+  space+  g-
10.32  space-  d+  space+  d-
10.92  space-  f+  space+  f-
12.12  space-  v+  space+  v-
12.72  space-  4+  space+  4-
13.32  space-  r+  space+  r-
14.52  space-  f+  space+  f-
15.72  space-  t+  space+  t-
16.32  space-  e+  space+  e-
16.92  space-  5+  space+  5-
18.12  space-  t+ a+  space+  t- a-
18.72  space-  e+  space+  e-
19.32  space-  5+  space+  5-
20.52  space-  t+ a+  space+  t- a-
21.12  space-  e+  space+  e-
21.72  space-  5+  space+  5-
22.32  space-  a+  space+  a-
22.92  space-  v+  space+  v-
24.12  space-  4+ q+  space+  4- q-
24.72  space-  t+  space+  t-
25.32  space-  g+  space+  g-
25.92  space-  d+  space+  d-
26.52  space-  f+  space+  f-
27.72  space-  v+  space+  v-
28.32  space-  4+  space+  4-
28.92  space-  r+  space+  r-
30.12  space-  f+  space+  f-
31.92  space-
32.22  .
32.37  0+ 0-
`,
  },
  {
    name: "Halo — theme song",
    kind: 'anchored',
    score: `# halo (theme song) — the five-note figure on one held bow: la · do' · ti · sol · la
# (A4 440 · C5 528 · B4 495 · G4 396 · A4 440 over do = C4 at 264)
# tuned up silently before the bow sounds: 5,4,w land re, mi, la with space
# still closed — the D never speaks · sol->la steps the small tone (4) · after
# the bow lifts, the octave shift, undone: r steps up to do', z drops it home

0.00 sethz 264
0.01 5+ 5-
0.20 4+ w+ 4- w-
0.22 space+
1.40 r+ r-
2.50 g+ g-
3.60 d+ d-
4.70 4+ 4-
5.50 space-
5.60 r+ z+ r- z-
`,
  },
  {
    name: "Zelda's Lullaby — pure steps",
    kind: 'anchored',
    score: `# zelda's lullaby (ocarina of time) — the B-D-A rock and the C-B-A sigh, sung low
# around do = C4 at 264, exactly as transcribed: the lullaby hangs BELOW the
# root (B3 ti-down · A3 la-down · G3 sol-down) — pure folded degrees, no sethz
# three chords in the draft were a few cents sharp, made pure here: B->D rides
# one r (6:5, the 5,t stopped at 135:64 mid-flight) · D->A3 uses b,f through C
# (the s landed 27:32 = 222.75, not 220) · the high A takes 4,w through mi (the
# q landed 27:16, not the true octave 440), then descends G-D-C-B-A by v,s,b,g,b
# straight down, every step pure · and the return home is r, not w: from A3 the
# 6:5 climbs to exactly C — the draft's w, 4:3, would have landed 293, a flat D

0.00 sethz 264
0.01  g+ g-
0.02  space+
0.50  r+ r-
1.00  b+ f+ b- f-
1.50  v+ v-
1.75  4+ 4-
2.25  5+ 5-
2.75  r+ r-
3.25  4+ w+ 4- w-
3.75  v+ v-
4.00  s+ s-
4.50  b+ b-
4.75  g+ g-
5.00  b+ b-
5.50  space-
5.50  v+ v-
5.75  space+
6.00  4+ 4-
6.25  space-
6.25  r+ r-
`,
  },
  {
    name: "Halo — theme song — as first transcribed",
    kind: 'drifting',
    drift: [-4, 4, -1, 0], // 81:80 — the tune rises one syntonic comma per loop
    score: `# the theme exactly as first transcribed — the drifter's own copy. every step is
# a clean ratio off a silent re (D stays tuning, never tone), and NONE of the
# landings is a degree of C: 27/16 · 81/40 · 243/128 · 243/160 · 2187/1280 —
# pure fifths, thirds and tones all the way, all against where they came from,
# not against home. the lifted bow's b+a means to walk back but lands at 81:80,
# one syntonic comma sharp — which is the whole point: loop it and the tune
# climbs 21.5 cents every pass, going slowly out of its own tune forever.
# (it takes about 56 loops to round the octave back around)

0.00 sethz 264
0.01 5+ 5-
0.22 space+
0.20 q+ q-
1.40 r+ r-
2.50 g+ g-
3.60 d+ d-
4.70 5+ 5-
5.50 space-
5.60 b+ a+
5.61 b- a-
`,
  },
  {
    name: "Zelda's Lullaby — as first transcribed",
    kind: 'round trip',
    score: `# the lullaby exactly as transcribed — every step a clean ratio, the drift
# wandering wherever the tune goes, and the walk ties off home by the last key.
# the comma detours are the feature, not the bug: the s at 1.0 stands on
# 27:32 (A3 at 222.75, a syntonic comma proud of true), the q leaps the
# Pythagorean 27:16 fifth (445.5), the B->D pair passes through 135:64 —
# each still pure against the note it just left, none of them pure against C.
# one edit only: the closing step is r, not w — from A3 the true 6:5 climb to
# C is r (w's 4:3 lands a small tone short, at 10:9); with it the loop ties.

0 g+ g-
0 space+
.5 5+ t+ 5- t-
1 s+ s-
1.5 v+ v-
1.75 4+ 4-
2.25 4+ 4-
2.75 5+ t+ 5- t-
3.25 q+ q-
3.75 b+ b-
4 s+ s-
4.5 b+ b-
4.75 g+ g-
5 b+ b-
5.5 space-
5.5 v+ v-
5.75 space+
6 4+ 4-
6.25 space-
6.25 r+ r-
`,
  }
];
