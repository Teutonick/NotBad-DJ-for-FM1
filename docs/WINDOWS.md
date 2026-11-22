# FM‑1 DJ on Windows 11

[Русская версия](ru/WINDOWS.md)

Use a current version of Google Chrome for the web app. Firmware installation uses the same `fm1-dj-0.1.0.fwsc` package as on macOS. This hardware acceptance procedure has yet to run on a physical Windows PC with an FM-1.

## Firmware checks

Use **Settings → Firmware** and follow the [firmware safety guide](FIRMWARE-SAFETY.md). Run the checks below after the configuration has been cleared and the firmware has been installed on a test device under controlled conditions.

## Hardware acceptance

| Check | Expected result |
| --- | --- |
| USB | An FM-1 output appears under **Settings → System → Sound → Output**. The MIDI input and output appear in Chrome after selecting **Connect FM-1**. |
| Bidirectional MIDI | **MIDI connected** and **Firmware 0.1.0** appear in Hardware diagnostics. Select the MIDI input and output separately if needed. Turning ALGORITHM moves the on-screen crossfader, and the FM-1 display shows both decks. |
| Separate outputs | In **Audio**, select the PC speakers explicitly for Master and the FM-1 for Cue. After selecting **Enable Cue Output**, **Test Master** plays only through the speakers and **Test headphones** plays only through the FM-1 headphones. |
| Cue and mix | Import the demo tracks with **Add demo tracks** and load decks A and B. Start both decks from the FM-1, move the crossfader to A, and enable PFL B. A plays through the speakers and B through the headphones. Repeat with the decks reversed, then check Cue with both decks and make a crossfader transition. |
| Reconnection | Unplug the FM-1 during playback. Master keeps playing and Cue remains inaudible through the speakers. Reconnect the cable. MIDI and the display recover after the firmware responds. Select the Cue output again if needed and select **Enable Cue Output**. |
| Extended run | Play real tracks for 60 minutes and repeat PFL, Sync and transitions. Record any audible gaps, clicks or Cue lag. |
| Rollback | Verify that the recovery tool recognizes the device. Follow the [firmware safety guide](FIRMWARE-SAFETY.md) if a full restore is needed. |

If Windows sees the FM-1 but it is missing from **Audio**, check the site's microphone permission in Chrome and desktop app microphone access under **Settings → Privacy & security → Microphone**. Include the Windows version from `winver`, the Chrome version, the result of each check, and the audio and MIDI port names at the first failure in the report.
