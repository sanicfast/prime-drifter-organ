// Prime Drifter Organ — Regression Tests

// === Test Harness ===

let passed = 0;
let failed = 0;
const results = [];

function assert(name, condition, detail) {
  if (condition) {
    passed++;
    results.push({ name, status: 'pass' });
  } else {
    failed++;
    results.push({ name, status: 'fail', detail: detail || '' });
  }
}

function assertApprox(name, actual, expected, tolerance = 1e-9) {
  const ok = Math.abs(actual - expected) < tolerance;
  assert(name, ok, ok ? '' : `expected ${expected}, got ${actual}`);
}

function assertVec(name, vec, expectedExp) {
  const ok = vec.equals(new PrimeVector(...expectedExp));
  assert(name, ok, ok ? '' : `expected [${expectedExp}], got ${vec.toString()}`);
}

function assertFreq(name, vec, baseHz, expectedHz, tolerance = 1e-9) {
  const actual = vec.toFrequency(baseHz);
  assertApprox(name, actual, expectedHz, tolerance);
}

// === Test Suite: PrimeVector Basics ===

const ZERO = new PrimeVector(0, 0, 0, 0);
assert('zero vector isZero', ZERO.isZero());
assert('zero vector toString', ZERO.toString() === '[0, 0, 0, 0]');

const A = new PrimeVector(1, 2, 0, 0);
const B = new PrimeVector(-1, 0, 3, 1);
assertVec('addition', A.add(B), [0, 2, 3, 1]);
assertVec('negate', A.negate(), [-1, -2, 0, 0]);
assertVec('add identity', A.add(ZERO).equals(A) ? A : ZERO, [1, 2, 0, 0]);
assert('add inverse = zero', A.add(A.negate()).isZero());
assert('addition commutative', A.add(B).equals(B.add(A)));

// === Test Suite: Frequency Computation ===

assertFreq('root = base', ZERO, 220, 220);
assertFreq('octave up', new PrimeVector(1, 0, 0, 0), 220, 440);
assertFreq('octave down', new PrimeVector(-1, 0, 0, 0), 220, 110);
assertFreq('fifth up (3:2)', new PrimeVector(-1, 1, 0, 0), 220, 330);
assertFreq('major third (5:4)', new PrimeVector(-2, 0, 1, 0), 220, 275);
assertFreq('7:4 harmonic seventh', new PrimeVector(-2, 0, 0, 1), 220, 385);
assertFreq('6:5 minor third', new PrimeVector(1, 1, -1, 0), 220, 264);
assertFreq('7:5', new PrimeVector(0, 0, -1, 1), 220, 308);
assertFreq('9:8 whole tone', new PrimeVector(-3, 2, 0, 0), 220, 247.5);

// === Test Suite: Interval Arithmetic ===

// 3:2 then 4:3 = 2:1 (octave)
const fifth = new PrimeVector(-1, 1, 0, 0);
const fourth = new PrimeVector(2, -1, 0, 0);
assertVec('fifth + fourth = octave', fifth.add(fourth), [1, 0, 0, 0]);
assertFreq('fifth + fourth = octave freq', fifth.add(fourth), 220, 440);

// Commutative: 4:3 then 3:2 = same
assertVec('fourth + fifth = octave', fourth.add(fifth), [1, 0, 0, 0]);

// Two fifths = 9:4
assertFreq('two fifths = 9:4', fifth.add(fifth), 220, 495);

// Stack of 4 fifths: 3:2 x 3:2 x 3:2 x 3:2 = 81:16
const fourFifths = fifth.add(fifth).add(fifth).add(fifth);
assertFreq('four fifths = 81:16', fourFifths, 220, 220 * 81 / 16);

// Major third + minor third = fifth (just intonation)
const majorThird = new PrimeVector(-2, 0, 1, 0); // 5:4
const minorThird = new PrimeVector(1, 1, -1, 0); // 6:5
assertFreq('major 3rd + minor 3rd = 5th', majorThird.add(minorThird), 220, 330);

// === Test Suite: Movement Key Correctness ===

// Each movement key should produce the stated frequency ratio
const expectedRatios = {
  'Digit1': 2 / 1,
  'Digit2': 3 / 1,
  'Digit3': 12 / 5,
  'Digit4': 7 / 4,
  'Digit5': 9 / 8,
  'KeyZ': 1 / 2,
  'KeyX': 1 / 3,
  'KeyC': 5 / 12,
  'KeyV': 4 / 7,
  'KeyB': 8 / 9,
  'KeyQ': 3 / 2,
  'KeyW': 4 / 3,
  'KeyE': 5 / 4,
  'KeyR': 6 / 5,
  'KeyT': 16 / 15,
  'KeyA': 2 / 3,
  'KeyS': 3 / 4,
  'KeyD': 4 / 5,
  'KeyF': 5 / 6,
  'KeyG': 15 / 16,
};

for (const [code, expected] of Object.entries(expectedRatios)) {
  const move = ALL_MOVES[code];
  assert(`key ${code} exists`, move !== undefined);
  if (move) {
    const actualRatio = move.vector.toFrequency(1);
    assertApprox(`key ${code} (${move.ratio}) ratio`, actualRatio, expected, 1e-12);
  }
}

// All big moves should be reciprocals of their paired small moves
const reciprocalPairs = [
  ['Digit1', 'KeyZ'],
  ['Digit2', 'KeyX'],
  ['Digit3', 'KeyC'],
  ['Digit4', 'KeyV'],
  ['Digit5', 'KeyB'],
  ['KeyQ', 'KeyA'],
  ['KeyW', 'KeyS'],
  ['KeyE', 'KeyD'],
  ['KeyR', 'KeyF'],
  ['KeyT', 'KeyG'],
];

for (const [up, down] of reciprocalPairs) {
  const pair = ALL_MOVES[up].vector.add(ALL_MOVES[down].vector);
  assert(`reciprocal pair ${up}+${down} = zero`, pair.isZero());
}

// === Test Suite: Octave Folding ===

// Frequency within range stays put
assertApprox('fold: within range', foldToAudible(220), 220);

// Too low gets doubled up
assertApprox('fold: below range', foldToAudible(20), 80); // 20→40→80

// Too high gets halved down
assertApprox('fold: above range', foldToAudible(4000), 1000); // 4000→2000→1000

// Folding is always in range
for (let i = -20; i <= 20; i++) {
  const raw = 220 * Math.pow(2, i);
  const folded = foldToAudible(raw);
  assert(`fold: 220*2^${i} in range`, folded >= 55 && folded <= 1760,
    `${raw} -> ${folded} out of range`);
}

// Odd frequencies also fold correctly
for (const f of [33, 123.4, 567, 999, 3210]) {
  const folded = foldToAudible(f);
  assert(`fold: ${f} in range`, folded >= 55 && folded <= 1760,
    `${f} -> ${folded} out of range`);
}

// === Render Results ===

const resultsEl = document.getElementById('results');
const summaryEl = document.getElementById('summary');

const suites = {};
for (const r of results) {
  // group by prefix before first space or period
  const key = r.name.includes('(') ? 'Movement Keys' : 'Core';
  if (!suites[key]) suites[key] = [];
  suites[key].push(r);
}

// flat render
let html = '<div class="suite"><div class="suite-title">all tests</div>';
for (const r of results) {
  const cls = r.status === 'pass' ? 'pass' : 'fail';
  const detail = r.detail ? ` — ${r.detail}` : '';
  html += `<div class="test ${cls}">${r.status === 'pass' ? '✓' : '✗'} ${r.name}${detail}</div>`;
}
html += '</div>';
resultsEl.innerHTML = html;

const total = passed + failed;
summaryEl.innerHTML = failed === 0
  ? `<span style="color:#7fdbca">ALL ${total} TESTS PASSED</span>`
  : `<span style="color:#ff7b7b">${failed} / ${total} FAILED</span> (${passed} passed)`;
