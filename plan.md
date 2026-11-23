# Prime Drifter Organ — Build Plan

Tech stack: vanilla HTML / CSS / JS, Web Audio API, Canvas for visualization. No frameworks, no build step.

---

## Step 1 — Hello Sine

**Goal:** A tone sounds in the browser.

- Create project structure: `index.html`, `style.css`, `app.js`
- Initialize AudioContext on first user interaction
- Create a sine oscillator at 220 Hz
- Click or spacebar toggles sound on/off
- Console-log the frequency

**Test:** Open in browser, press spacebar, hear a tone. Press again, silence.

---

## Step 2 — Prime Vector State

**Goal:** Track harmonic position as exact rational state instead of a float.

- Define `PrimeVector` class: `[exp2, exp3, exp5, exp7]`
- Arithmetic: add vectors, negate, compare
- Convert to frequency: `baseHz * 2^(a) * 3^(b) * 5^(c) * 7^(d)`
- Convert to reduced fraction string (numerator/denominator using prime factorization)
- Define all movement vectors as named constants
- `0` key resets to `[0, 0, 0, 0]`

**Test:** Unit-test vector math. Up a fifth `[-1,1,0,0]` then up a fourth `[2,-1,0,0]` should equal an octave `[1,0,0,0]`. Verify: `(-1+2, 1-1, 0, 0) = (1, 0, 0, 0)` = 2:1 ✓

---

## Step 3 — Left Hand Root Navigation

**Goal:** Keyboard moves the root around frequency space.

- Map keys:
  - Number row `12345` → big moves up (2:1, 3:1, 4:1, 7:4, 5:2)
  - Bottom row `zxcvb` → big moves down (reciprocals)
  - Top row `qwert` → small moves up (3:2, 4:3, 5:4, 6:5, 7:5)
  - Home row `asdfg` → small moves down (reciprocals)
- Each keypress updates the prime vector
- Display current Hz and reduced fraction on screen
- Tone follows the root frequency in real time

**Test:** Navigate around. Fraction display makes sense. 12345 raises pitch, zxcvb lowers it.

---

## Step 4 — Spacebar Articulation + Envelope

**Goal:** Sound is triggered, not continuous. Feels like an instrument.

- Spacebar keydown = start sound, keyup = stop sound
- Simple ADSR envelope using Web Audio gain scheduling
- Start with fixed defaults: A=0.05s, D=0.1s, S=0.7, R=0.3s
- Slider controls in UI to adjust attack, decay, sustain, release

**Test:** Press and hold spacebar — note swells in, sustains, releases on keyup. Sliders change the feel.

---

## Step 5 — Organ Timbre

**Goal:** Sounds like a breathy organ pipe, not a bare sine.

- Base: sine oscillator at the fundamental
- Add a second oscillator at 2x frequency (octave) at low gain (subtle body)
- Add filtered white noise (bandpass around fundamental, narrow Q) for breathiness
- On note-on: short noise burst through a fast envelope for "chiff"
- Balance so it's clearly a pitched tone with air around it

**Test:** Close your eyes — does it sound like a reed/pipe and not a synth sine?

---

## Step 6 — Octave Folding

**Goal:** Audible range stays comfortable; prime vector unaffected.

- Define audible comfort range: e.g. 80 Hz – 800 Hz
- After computing Hz from prime vector, repeatedly double or halve to fold into range
- Use this folded frequency for the oscillator only
- Display both: true Hz (from vector) and folded Hz (what you hear)
- Small visual indicator showing how many octaves folded up/down

**Test:** Navigate far up or down. Audio stays in range. Display shows the drift.

---

## Step 7 — Right Hand Chord Presets

**Goal:** Right hand shapes harmony relative to root.

- Home row keys: `h j k l ; '` → mutually exclusive chord presets
- Each preset = list of ratio multipliers applied to root
- When a chord is active, spacebar plays all voices simultaneously
- `,` clears chord selection
- No chord + spacebar = root only
- Visual display of which chord is active

**Test:** Press `h` then spacebar → major triad. Press `j` → switches to minor. Press `,` then spacebar → single root.

---

## Step 8 — Additive XOR Ratios

**Goal:** Top row adds/removes individual voices on top of chord presets.

- Top row (right side, e.g. `y u i o p`) → additive ratios: 9:8, 5:4, 4:3, 3:2, 7:4
- Non-exclusive: multiple can be active simultaneously
- XOR logic: if a ratio is already in the active chord preset, toggling it removes it from the chord
- Selecting a new chord preset clears all additive toggles
- Visual display of all active voices

**Test:** Active major triad (h) has 5/4. Toggle the 5:4 additive key → 5/4 disappears from the chord, leaving root + 3/2 only.

---

## Step 9 — Undo / Redo

**Goal:** Full undo history of root movements.

- Maintain an action stack of (vector_delta, description) tuples
- `Backspace` pops the last action and applies its inverse
- `\` replays the last undone action
- `0` (reset) pushes a synthetic delta that zeros the vector
- Disable redo when a new action is taken after undoing

**Test:** Navigate a path, then hold backspace — watch it retrace. Then `\` to redo.

---

## Step 10 — Tonic Hum

**Goal:** Reference drone so you can hear how far you've drifted.

- `.` toggles a quiet sustained tone at the original starting Hz
- Separate oscillator + gain, independent of the main voice
- Folded into audible range like the main voice
- Visual indicator showing hum is active

**Test:** Enable hum, navigate away from start. You can hear the beating/interference between your root and the original tonic.

---

## Step 11 — Lattice Visualization

**Goal:** See your position in prime-harmonic space.

- Canvas element showing a 2D lattice:
  - X-axis = exponent of 3
  - Y-axis = exponent of 5
  - Color/hue = exponent of 7
- Plot history trail (fading path of recent positions)
- Current position highlighted
- Log-scale Hz history graph below or beside lattice
- Show current reduced fraction as text

**Test:** Navigate around — lattice trail follows. 7-exponent shifts color. Graph shows Hz over time in log scale.

---

## Step 12 — Hold/Perform Mode

**Goal:** Performance-style playing where chord keys must be held.

- `/` enters hold mode (clears all toggles first)
- In hold mode, chord keys only sound while physically held down
- Release = voice cuts (respecting release envelope)
- Same `/` again (or maybe Esc) returns to toggle mode
- Visual indicator for active mode

**Test:** Enter hold mode, hold `h` + spacebar = major triad sounds. Release `h` mid-sound = chord drops to root.

---

## Step 13 — Step Pivot Chord Mode

**Goal:** Chords can act as root transposers.

- `n` toggles step pivot mode
- When ON: after spacebar sounds a chord, root vector advances by the prime vector of the highest ratio in that chord
- When OFF (default): chords don't affect root
- Visual indicator for mode
- Integrate with undo system

**Test:** Pivot mode on. Play a major triad (highest ratio = 3/2). After sounding, root should shift up a fifth. Undo should reverse it.

---

## Step 14 — Cheatsheet Overlay

**Goal:** In-app reference for all key bindings and concepts.

- Toggleable panel (maybe `?` key or a button)
- Shows all key mappings with labels
- Explains prime vector system briefly
- Explains chord logic (mutual exclusion, XOR, hold mode)
- Key visual design: looks like a physical instrument legend

**Test:** Readable, accurate, doesn't block the main UI.

---

## Step 15 — Recording & Playback

**Goal:** Capture and replay performances.

- Record mode: log (timestamp_ms, action_type, key) for every interaction
- Export as JSON file (download via Blob + anchor click)
- Import JSON → replay actions at recorded timing
- Store initial Hz in JSON header
- Basic playback controls (play, stop)

**Test:** Record a short session, export, reload page, import, replay sounds identical.

---

## Step 16 — Polish

- Keyboard input handling: prevent key-repeat for toggles, handle simultaneous presses
- Master volume control
- Handle edge cases (rapid spacebar, tabbing away mid-note)
- Responsive layout
- Title / favicon / basic aesthetic
- Performance: ensure audio doesn't crackle with many voices
- Cleanup: dead code, dead comments

---

## Build Order Summary

| # | Step | Deliverable |
|---|------|-------------|
| 1 | Hello Sine | A tone in the browser |
| 2 | Prime Vector State | Exact rational math layer |
| 3 | Left Hand Navigation | Keyboard-controlled root |
| 4 | Articulation + Envelope | Playable note triggering |
| 5 | Organ Timbre | Pipe-like sound quality |
| 6 | Octave Folding | Comfortable audible range |
| 7 | Chord Presets | Right hand harmony |
| 8 | Additive XOR Ratios | Fine-grained voicing |
| 9 | Undo / Redo | Safe exploration |
| 10 | Tonic Hum | Drift awareness |
| 11 | Lattice Visualization | Spatial understanding |
| 12 | Hold / Perform Mode | Expressive playing |
| 13 | Step Pivot Chord Mode | Chord-as-transposer |
| 14 | Cheatsheet | Self-documenting app |
| 15 | Recording & Playback | Save/replay performances |
| 16 | Polish | Ship it |
