# Prime Drifter Organ

> "drifting just-intonation organ built on prime-ratio vectors."

So here's my concept for a novel musical instrument:

## Core Concept

- I want to be able to play music in a html, css, js browser app.
- Basically you can adjust what you want your beginning hz level to be and then you can go up or down in perfect intervals by pressing buttons on the keyboard.
- Obviously we'll have fifths (3:2) fourths (4:3), octaves (2:1). but also i feel like you could have some interesting stuff like other ratios like 3:1 or 5:4. Every time you play a new note, that becomes your new hz level that your next note will be calculated off of.
- maybe left hand moves the root around via ratios. right hand decides what chord should be played (based exclusively off the root by default. we can maybe have an option to jump the root to the high end of the chord?). spacebar actually sounds whatever is armed like a guitar kinda. can move the root around with the left hand while still sounding the instrument.

## Philosophy

- it seems like a really simple idea that falls out of the music theory naturally - i'm surprised that it's not talked about / done a lot already. I think it's just that before computers you couldn't just retune your instrument between every note to actually do it so people naturally got very locked into the equal temperament thinking where every key has to make the same note every time you press it. i think it's cool that you could go "out of tune" but also your ear will hear the exact ratios and feel like you're still in tune because you are.. like forcing everything into equal temperament is kind of messed up in its own way.

## Sound & Timbre

- organlike timbre. breathy wind blown sounding.
- maybe we could have a tonic reference noise playing to remind the ear that you're actually leaving the tuning that you expected?

## Controls

### Left Hand — Root Navigation

- 12345 and zxcvb are reciprocal big moves like 2:1, 3:1, 4:1, 7:4, 9:8 or 5:2
- qwert/asdfg are reciprocal smaller moves like 3:2, 4:3, 5:4, 6:5, 7:5

### Right Hand — Chords

- right hand controls chords.
- home row is chord presets (hjkl;'). these are mutually exclusive with each other. you toggle them on with a single keystroke and then they stay engaged until you make another keystroke that changes it.
  - h - Major Triad (1 : 5/4 : 3/2)
  - j - Minor Triad (1 : 6/5 : 3/2)
  - k - Harmonic 7th (1 : 5/4 : 3/2 : 7/4)
  - l - Sus4 (1 : 4/3 : 3/2)
  - ; - Wide Triad (1 : 5/4 : 3/2 : 2)
  - ' - Open tenth (1: 3/2 : 5/2)
- , key undoes all chord toggles.
- if spacebar pressed with no chord toggles set it just plays the current root.
- top row toggles additive, non exclusive ratios. maybe 9:8, 5:4, 4:3, 3:2, 7:4. if one of these ratios is also present in a chord that's toggled it removes that nnote from the chord so it's really an XOR. if you do a new home row chord preset, it clears your top row toggles to prevent confusion
- / key enters mode where you have to actually hold your chord keys and you can't just toggle them. for more musical performance type improvisation... also insta clear any current toggles
- . is tonic hum toggle

### Other Keys

- press 0 to return to original root. Pressing 0 pushes a reset step (adding [-a, -b, -c, -d] so you land back at [0, 0, 0, 0]). this makes it work nicely with the undo history stack.
- press backspace to undo last root shift. can have a whole undo stack. \ to redo.

## Envelope

- need some kind of an envelope. maybe have some sliders so you can control attack etc

## Octave Folding

- octave fold if you get too low or too high so you stay in a nice range to listen to, without actually impacting the note you're playing as your root.

## Visualization & Display

- definitely we shoud show your current hz of your root as well as the root prime vector. 

## Internal State

- should store your current root as the exponents of all the primes you've done. 2, 3, 5, 7. up an octive is (1, 0, 0, 0) down is (-1, 0, 0, 0). up a fifth (3:2) is (-1, 1, 0, 0) this way they add and we can plot the 3 and 5 exponents as a 2d lattice. add coloring to show where you are in 7 space as well. 2 doesn't matter because octive doesn't change the note.

## Modes

### Step Pivot Chord Mode

- n to engage step pivot chord mode
  - off (default) chords sound relative to your current root hz. they do not update the root hz.
  - on - after a chord sounds, the root hz is updated with the highest ratio of the chord being added into the prime exponent vector.

## Cheatsheet

- obv we need a cheatsheet that explains the different keys and the system of how it works.

## Recording & Playback

- probably should have some way to feed in a file and have it play it back. maybe also you can have it output your performance as a replayable json file. need to have the start hz ofc.
