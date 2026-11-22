# Control map and protocol

[Русская версия](ru/PROTOCOL.md)

## FM‑1 DJ 0.1.1

`OCT−` and `OCT+` select decks A and B. Panel commands act on the active deck. The `→ A` and `→ B` buttons in the web app load the track onto the specified deck and make that deck active.

| Button | Action | MIDI |
| --- | --- | --- |
| OCT− / OCT+ | Select deck A / B | 85 / 86 |
| SEL | Load the selected library track | 87 |
| PLAY | Play / pause | 88 |
| HOME | Stop and return to Cue | 89 |
| FX | Toggle Echo | 90 |
| EDIT | Hold to access the secondary knob functions | 91 |
| GLO | Sync when synchronization is available | 92 |
| ENV | Toggle PFL for the deck in the headphones | 93 |
| ARP | Start a four-beat loop or disable the current loop | 94 |
| LFO / SEQ | Halve / double the loop length | 95 / 96 |
| SAVE | Save the current loop | 97 |
| REC / EDIT + REC | Set the start / end of a manual loop | 98 |

The five leftmost keys, including black keys, are F3, F♯3, G3, G♯3 and A3. The first two temporarily bend the tempo while held. The next three set or recall Hot Cues 1–3. These keys send notes 99–103. The remaining 22 keys are unassigned. Holding REC at power-on still enters recovery mode.

| Encoder | Action | While holding EDIT |
| --- | --- | --- |
| SELECT / PRESETS | Browse tracks in the current library or playlist | Same |
| ALGORITHM | Crossfader | Same |
| KNOB 1 | Deck volume | Filter |
| KNOB 2 | Low EQ | Tempo |
| KNOB 3 | Mid EQ | Headphone Cue/Master blend |
| KNOB 4 | High EQ | Echo amount |
| MASTER | Local FM‑1 output level | Same |

### Compatibility with 0.1.0

The web app still accepts legacy commands. In 0.1.0, the lowest 12 keys controlled deck A, the highest 12 controlled deck B, and the three keys in the middle controlled SHIFT, the latched secondary layer, and Echo. The new panel layout requires firmware 0.1.1 and the updated web app.

The SELECT, ALGORITHM, PRESET and K1–K4 encoders send CC 16–22 on channel 1. Values 1–63 encode a positive detent count. Values 65–127 encode a negative count in modulo-128 two's complement. The app applies acceleration.

Browser-to-FM‑1 SysEx uses the format `F0 7D 46 44 01 type seq … check F7`. All inner bytes are seven bits wide. The sum from `7D` through `check` is a multiple of 128. Type 0 has no payload and resets the sequence number. The device responds with type 2 and three firmware version bytes. Type 1 carries a single atomic 113-byte snapshot. Its first three bytes contain the crossfader position, active deck and layer. Two 55-byte blocks follow, deck A first.

| Block offset | Data |
| --- | --- |
| 0 | PLAY, SYNC, PFL and Echo flags |
| 1–2 | BPM × 10, low seven bits first |
| 3–4 | Normalized position and phase |
| 5–10 | Volume, LOW, MID, HIGH, filter and Echo Amount |
| 11–30 | Space-padded ASCII title |
| 31–54 | 24 peaks from the track envelope |

The browser waits for a valid type 2 reply on the selected MIDI input before sending the first snapshot or accepting panel commands. It repeats the handshake after changing the port pair or reconnecting. The browser refreshes the snapshot every 125 ms and after a MIDI event. The device accepts sequence numbers in the forward half of the modulo-128 range and rejects duplicates and invalid checksums. The device resets its state and mutes USB audio after 1.5 seconds without a snapshot or when USB disconnects.

Hardware diagnostics stores a custom mapping for MIDI notes 53–87 in JSON. For 0.1.0, for example, `{"53":68,"68":53}` swaps Play/Pause on decks A and B. Panel commands and less common 0.1.1 commands on notes 88–103 have fixed assignments.
