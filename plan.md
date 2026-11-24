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
- Define all movement vectors as named constants
- `0` key resets to `[0, 0, 0, 0]`

**Test:** Unit-test vector math. Up a fifth `[-1,1,0,0]` then up a fourth `[2,-1,0,0]` should equal an octave `[1,0,0,0]`. Verify: `(-1+2, 1-1, 0, 0) = (1, 0, 0, 0)` = 2:1 ✓

---

## Step 3 — Left Hand Root Navigation

**Goal:** Keyboard moves the root around frequency space.

- Map keys:
  - Number row `12345` → big moves up (2:1, 3:1, 7:4, 10:9, 9:8)
  - Bottom row `zxcvb` → big moves down (reciprocals)
  - Top row `qwert` → small moves up (3:2, 4:3, 5:4, 6:5, 7:5)
  - Home row `asdfg` → small moves down (reciprocals)
- Each keypress updates the prime vector
- Display current Hz on screen
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

## Step 11 — Visualization (shipped as the overtone view, not the lattice)

**Goal:** See what the ear is grading.

The planned 2D/4D prime-lattice was dropped: mapping harmonicity is more
interesting than mapping position. The shipped **overtones view** draws every
sounding voice's partial stack on a log-frequency axis and marks cross-voice
partial collisions: gold dot = dead-on (pure interval signature), red ✕ =
near-miss buzz with its ΔHz beat rate. Fades voices trail dimly; the hum
grades everything against the tonic.

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

## Step 17 — Invert Mode (post-plan addition)

**Goal:** Play chords upside down.

- `m` toggles invert mode
- Chord and additive voices become their reciprocals: major = root + 4:5 + 2:3
- Pivot steps to the voice farthest from the root — upward normally, downward when inverted
- Toggling while a chord sounds live-flips the voicing via the voice crossfade
- Left-hand root navigation unaffected

---

## Step 18 — Initial Root Control (post-plan addition)

**Goal:** Pick where the zero vector starts.

- Log slider, 55–880 Hz, sets `baseHz` live (default C4 = 264 Hz, scientific pitch)
- Glides sounding voices and retunes the tonic hum while dragging
- Readout shows approximate equal-tempered note name as a courtesy (≈)
- A setting, not a move: stays out of the undo stack; `0` always returns here

---

## Step 19 — Timbre / Body (post-plan addition)

**Goal:** Make the tuning audible, not just true.

- ×3 ×4 ×5 ×7 harmonic partials per voice and on the hum, mixed by a "body" slider (0 = airy sine, default 0.6)
- The upper partials are where pure intervals collide into stillness and mistunings (like 81:64) buzz — purity becomes gradeable by ear
- Partials glide with root moves and retune live while notes sound

---

## Step 13 — Step Pivot Chord Mode

**Goal:** Chords can act as root transposers.

- `n` toggles step pivot mode
- When ON: after spacebar sounds a chord, root vector advances by the prime vector of the highest ratio in that chord
- While holding a note in pivot mode, `,` lands on the top voice: lower voices fade, that voice relabels as the new root and keeps ringing
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

## Step 15 — Playback: the score system (shipped)

**Goal:** Let the organ read and play music — in its own language.

The score is the instrument's native notation: timestamped keystroke
choreography. What the recorder writes is exactly what the player reads.

- **Score format** (text, one event per line): `<time> <key>+` press,
  `<key>-` release, bare `<key>` tap; bare numbers anchor time, `+0.25`
  advances it; `#` comments. **`sethz <hz>`** retunes the initial root, so
  scores can be key-agnostic (`0.00 sethz 264` pins the piece to C4) — and
  dragging the root slider while recording captures the retune (coalesced).
  Friendly tokens mirror the keyboard
  (`space`, letters, `;` `'` `,` `.` `/` `del`); digit keys need `+/-`
  since bare digits are times. Parse + format live in prime-vector.js as
  pure functions (28 regression tests).
- **Record**: keystrokes captured with timestamps; stopping writes the
  score into the editor (leading comment headers survive the rewrite).
  Safety: an empty recording never touches the score; a recording that
  replaces a non-empty score parks it in a one-slot ↩ restore; clearing
  the editor and reloading brings the seeded example back.
- **Play**: re-dispatches recorded events through the real key handlers —
  every mode, glide, and voice-diff subtlety applies to playback exactly as
  to live playing, and live keystrokes can be layered over playback.
- **Transport**: rec / play / stop (stop releases held events, clears
  voicing, kills pending timers), loop toggle, live time/event counters.
  A **reset** toggle (default on) snaps to defaults before every pass —
  root home, chords released, hum and modes off — so plays and loops are
  repeatable instead of compounding the drift. Turn it off to layer a
  score over wherever the instrument currently lives. Escape stops
  playback. Hidden tabs stop instead of avalanche-replaying.
- **Song book**: built-in tunes (`SONGS` in prime-vector.js) written in the
  score format, loadable from a picker; every note verified pure by the
  regression suite — the drift vector of every song only ever visits exact
  5-limit scale degrees. Loading a song into the editor parks whatever it
  replaces in the ↩ restore slot.
- The score editor persists to localStorage; first run is seeded with the
  rainbow from the song book (one source of truth).

**Test:** score utilities and the song book under the regression suite;
every song parses clean, sounds pure, ends home, and round-trips through
format unchanged.

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
