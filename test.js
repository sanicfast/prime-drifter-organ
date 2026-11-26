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

// The syntonic story: the big tone (9:8) and small tone (10:9) stack to a pure 5:4,
// while two big tones give the sour Pythagorean 81:64
assertVec('9:8 + 10:9 = pure major 3rd', new PrimeVector(-3, 2, 0, 0).add(new PrimeVector(1, -2, 1, 0)), [-2, 0, 1, 0]);

// === Test Suite: Movement Key Correctness ===

// Each movement key should produce the stated frequency ratio
const expectedRatios = {
  'Digit1': 2 / 1,
  'Digit2': 3 / 1,
  'Digit3': 7 / 4,
  'Digit4': 10 / 9,
  'Digit5': 9 / 8,
  'KeyZ': 1 / 2,
  'KeyX': 1 / 3,
  'KeyC': 4 / 7,
  'KeyV': 9 / 10,
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

// === Test Suite: Octave Wrapping ===

// The audible band WRAPS: above the ceiling halving lands you back near the
// floor (the wrap), under the floor doubling lands you near the ceiling.
// No formula oracle this time — the operation is graded by its own
// definition: the landing must sit inside the band, must be the input times
// a power of two (checked exactly, by reversing the landing back out to the
// input — never by float logs), and must be reachable by the alternating
// placement walk (the input, octave-normalized to start near the band,
// doubled/halved until inside). Earlier oracle attempts — float log2 modulo,
// odd-core stripping, full-2-stripping, one-octave proximity — were all
// wrong about the fold; the fold never failed a definitional check.
{
  const low = 55, span = 4, up = low * Math.pow(2, span); // 55..880
  const cases = [220, 440, 55, 880, 890, 1000, 1760, 4000, 440 * 1024, 20, 33, 123.4, 567, 999, 3210];

  // the placement walk: the fold's own definition, spelled separately
  const place = (f) => { let g = f; while (g >= up || g < low) { if (g >= up) g /= 2; else g *= 2; } return g; };

  let inband = 0, powerOfTwo = 0, definitional = 0;
  for (const f of cases) {
    const got = foldToAudible(f, low, span);
    if (got >= low && got < up) inband++;
    // exact power-of-two check: reverse the landing back to the input by
    // doubling/halving (pure float-exact steps), both directions, deep
    let k = got, reach = false;
    for (let i = 0; i < 200; i++) {
      if (k === f) { reach = true; break; }
      k /= 2;
    }
    k = got;
    for (let i = 0; i < 200 && !reach; i++) {
      if (k === f) { reach = true; break; }
      k *= 2;
    }
    if (reach) powerOfTwo++;
    if (got === place(f)) definitional++;
  }
  assert('wrap: every value lands in band', inband === cases.length, `${inband}/${cases.length}`);
  assert('wrap: every landing is the input times a power of two',
    powerOfTwo === cases.length, `${powerOfTwo}/${cases.length}`);
  assert('wrap: the walk lands where its definition says',
    definitional === cases.length, `${definitional}/${cases.length}`);

  // named landmarks (band 55..880): edges resolve down, wraps land low
  assertApprox('fold: within range untouched', foldToAudible(220), 220);
  assertApprox('fold: below range doubles up', foldToAudible(20), 80);
  assertApprox('fold: the ceiling wraps to the octave below', foldToAudible(880), 440);
  assertApprox('fold: just past the ceiling', foldToAudible(890), 445);
  assertApprox('fold: far above lands low', foldToAudible(1000), 500);
  assertApprox('fold: the old example, wrapped', foldToAudible(4000), 500);
  assertApprox('fold: twelve octaves up lands mid-band', foldToAudible(440 * 1024), 440);

  // the drift-loop property: climbing past the ceiling re-enters one octave
  // lower and KEEPS CLIMBING — never sticks at the top
  assertApprox('wrap: keeps travelling past the top', foldToAudible(880 * 1.5), 660);
  assertApprox('wrap: keeps climbing after the wrap', foldToAudible(660 * 1.5), 495);

  // octave classes: any exact octave of an in-band pitch folds back onto the
  // band's representative of that class (idempotent, and octave-transparent)
  for (let i = -30; i <= 30; i++) {
    const raw = 220 * Math.pow(2, i);
    const w = foldToAudible(raw);
    assert(`wrap: 220*2^${i} lands on the class rep`,
      Math.abs(w - 220) < 1e-9 || Math.abs(w - 440) < 1e-9 || Math.abs(w - 110) < 1e-9 || Math.abs(w - 55) < 1e-9,
      `${raw} -> ${w}`);
    assert(`wrap: ${w} idempotent`, Math.abs(foldToAudible(w) - w) < 1e-9);
  }
}

// The band itself is settable: floor and width both move the tube
{
  assert('fold band: floor slider maps octaves above 55',
    Math.abs(foldLowFromSlider(0) - 55) < 1e-9 &&
    Math.abs(foldLowFromSlider(2) - 220) < 1e-9 &&
    Math.abs(foldLowFromSlider(7) - 7040) < 1e-9);
  assert('fold band: span defaults to 4 octaves', foldSpanOctaves() === 4);

  // a 220..880 tube (span 2): below doubles in, above wraps down, edges down
  assertApprox('narrow tube: below doubles up', foldToAudible(110, 220, 2), 220);
  assertApprox('narrow tube: far below re-enters near the ceiling', foldToAudible(45, 220, 2), 360);
  assertApprox('narrow tube: above wraps down', foldToAudible(1000, 220, 2), 500);
  assertApprox('narrow tube: the ceiling resolves down', foldToAudible(880, 220, 2), 440);
  assertApprox('narrow tube: in band untouched', foldToAudible(300, 220, 2), 300);

  // a wide tube wraps only after span octaves of climbing
  assertApprox('wide tube: still inside after seven', foldToAudible(264 * 128, 264, 8), 264 * 128);
  assertApprox('wide tube: eight up resolves the edge down', foldToAudible(264 * 256, 264, 8), 264 * 128);
  assertApprox('wide tube: keeps halving until inside', foldToAudible(264 * 512, 264, 8), 264 * 128);

  assert('fold band: span clamps high', (setFoldSpan(99), foldSpanOctaves() === 7));
  assert('fold band: span clamps low', (setFoldSpan(0), foldSpanOctaves() === 1));
  setFoldSpan(4);
  assert('fold band: restored to the house default', foldSpanOctaves() === 4);

  // the guard: silence and NaN land on the floor, never hang the walk
  assertApprox('fold guard: zero', foldToAudible(0), 55);
  assertApprox('fold guard: NaN', foldToAudible(NaN), 55);

  // tiles: which band an input sits in — the drift loop crosses tiles at the walls
  assert('fold tiles: band is tile 0', foldTile(440) === 0);
  assert('fold tiles: one tile up is 1', foldTile(880) === 1);
  assert('fold tiles: under the floor is -1', foldTile(27.5) === -1);
}

// === Test Suite: Score Format ===

// Token resolution
assert('score: space token', resolveScoreCode('space') === 'Space');
assert('score: digit token', resolveScoreCode('5') === 'Digit5');
assert('score: punctuation tokens',
  resolveScoreCode(';') === 'Semicolon' && resolveScoreCode("'") === 'Quote' &&
  resolveScoreCode(',') === 'Comma' && resolveScoreCode('.') === 'Period' &&
  resolveScoreCode('/') === 'Slash' && resolveScoreCode('\\') === 'Backslash');
assert('score: del token', resolveScoreCode('del') === 'Backspace');
assert('score: raw codes accepted', resolveScoreCode('keyG') === 'KeyG' && resolveScoreCode('SPACE') === 'Space');
assert('score: junk rejected', resolveScoreCode('bogus') === null);
assert('score: every code round-trips its token',
  Object.keys(SCORE_TOKENS).every(c => resolveScoreCode(SCORE_TOKENS[c]) === c));

// Basic parse
{
  const { events, errors } = parseScore('0.5 space+\n1.25 space-');
  assert('parse: no errors', errors.length === 0);
  assert('parse: two events', events.length === 2);
  assert('parse: times in ms', events[0].t === 500 && events[1].t === 1250);
  assert('parse: down flags', events[0].down === true && events[1].down === false);
}

// Bare token = tap (press + delayed release)
{
  const { events } = parseScore('1.0 h');
  assert('parse: tap expands to pair', events.length === 2 && events[0].down === true && events[1].down === false);
  assert('parse: tap gap', events[1].t - events[0].t === TAP_GAP_MS);
}

// Relative time, re-anchoring, and simultaneous events
{
  const { events } = parseScore('1.00 1+\n+0.5 1-\n0.25 space+ h+');
  assert('parse: relative advance', events.some(e => e.code === 'Digit1' && !e.down && e.t === 1500));
  assert('parse: absolute re-anchor', events.some(e => e.code === 'Space' && e.down && e.t === 250));
  assert('parse: simultaneous group', events.some(e => e.code === 'KeyH' && e.down && e.t === 250));
  assert('parse: ties keep written order',
    events.findIndex(e => e.code === 'Space') < events.findIndex(e => e.code === 'KeyH'));
}

// Comments and error reporting
{
  const { events, errors } = parseScore('# header\n0.5 g   # glide\n\nbogus+');
  assert('parse: comments ignored', events.length === 2 && events[0].code === 'KeyG');
  assert('parse: error line reported', errors.length === 1 && errors[0].line === 4);
}

// Bare numbers are time anchors, so 0-5 keys always need a +/- suffix
{
  const { events, errors } = parseScore('1.0 1');
  assert('parse: bare digit anchors time', events.length === 0 && errors.length === 0);
}

// Format then parse: identical event stream
{
  const src = parseScore('0 space+ 0+\n0.03 0-\n0.55 1+\n1.15 g+\n2.0 space-\n2.1 .');
  const rt = parseScore(formatScore(src.events));
  assert('roundtrip: same count', rt.events.length === src.events.length);
  assert('roundtrip: events equal', rt.errors.length === 0 &&
    rt.events.every((e, i) => {
      const o = src.events[i];
      return e.t === o.t && e.code === o.code && e.down === o.down;
    }));
}

// sethz command: retune the initial root
{
  const { events, errors } = parseScore('0.00 sethz 264\n1.0 space+');
  assert('parse: sethz event', errors.length === 0 &&
    events.some(e => e.type === 'sethz' && e.hz === 264 && e.t === 0));
  assert('parse: sethz arg consumed, not eaten as time',
    events.some(e => e.code === 'Space' && e.down && e.t === 1000));
}
{
  assert('parse: sethz missing arg', parseScore('1.0 sethz').errors.length === 1);
  assert('parse: sethz bad arg', parseScore('1.0 sethz oops').errors.length === 1);
  assert('parse: sethz non-positive arg', parseScore('1.0 sethz 0').errors.length === 1);
  assert('parse: sethz trailing junk rejected', parseScore('1.0 sethz 264abc').errors.length === 1);
  assert('parse: sethz double decimal rejected', parseScore('1.0 sethz 264.5.5').errors.length === 1);
}
{
  const { events } = parseScore('0.5 sethz 330.5 h');
  const rt = parseScore(formatScore(events));
  assert('roundtrip: sethz survives format', rt.errors.length === 0 &&
    rt.events.length === events.length && rt.events[0].hz === 330.5);
}

// === Test Suite: Built-in Songs ===

// Every song declares a kind — 'anchored', 'round trip', or 'drifting' — and
// the suite holds it to exactly that declaration: anchored songs only ever
// visit pure 5-limit degrees (octave-folded, so a ti below the root grades as
// the same degree as a ti above) and end home; round trips end home but are
// required to actually wander; drifting songs must end exactly where their
// declared drift says, so the catalog is honest about tunes that slowly go
// out of themselves on repeat.
{
  assert('songs: catalog has tunes', SONGS.length >= 4);
  assert('songs: every song declares a known kind',
    SONGS.every(s => ['anchored', 'round trip', 'drifting'].includes(s.kind)));
  for (const song of SONGS) {
    const g = gradeSongPurity(song);
    assert(`song "${song.name}": parses clean`, g.errors.length === 0 && g.events.length > 8);
    assert(`song "${song.name}": sounds`, g.sawSpace);
    assert(`song "${song.name}": is what it claims (${song.kind})`, songKindOk(song, g),
      `net [${g.net}], landingsPure ${g.landingsPure}`);
    assert(`song "${song.name}": round-trips through format`,
      parseScore(formatScore(g.events)).errors.length === 0);
  }
}

// The grader must actually discriminate, not rubber-stamp.
{
  const bow = '0.00 sethz 264\n0.05 space+\n';
  const walk = e => ({ score: bow + e + '0.95 space-' });
  const g1 = gradeSongPurity(walk('0.10 e+\n0.20 d+\n'));          // mi, home
  assert('kinds: clean round trip grades pure and home',
    g1.landingsPure && g1.net.join(',') === '0,0,0,0');
  const g2 = gradeSongPurity(walk('0.10 e+\n0.20 e+\n0.30 d+\n0.40 d+\n')); // 25/16 mid-walk
  assert('kinds: comma wander is caught (not pure)', !g2.landingsPure);
  assert('kinds: comma wander still ends home', g2.net.join(',') === '0,0,0,0');
  const g3 = gradeSongPurity(walk('0.10 q+\n'));                    // drifts to sol
  assert('kinds: un-closed drift detected', g3.net.join(',') === '-1,1,0,0');
  // mislabelled kinds must fail in every direction
  assert('kinds: liar rejected — wanderer claiming anchored',
    !songKindOk({ kind: 'anchored', score: walk('0.10 e+\n0.20 e+\n0.30 d+\n0.40 d+\n').score }, g2));
  assert('kinds: liar rejected — homebody claiming drifting',
    !songKindOk({ kind: 'drifting', drift: [-1, 1, 0, 0], score: walk('0.10 e+\n0.20 d+\n').score }, g1));
  assert('kinds: liar rejected — drift not matching its claim',
    !songKindOk({ kind: 'drifting', drift: [-2, 2, 0, 0], score: walk('0.10 q+\n').score }, g3));
  assert('kinds: undeclared kind rejected',
    !songKindOk({ score: bow }, g1));
  assert('kinds: labels',
    ratioString([-4, 4, -1, 0]) === '81:80' && driftCents([-4, 4, -1, 0]) === 21.5);
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
