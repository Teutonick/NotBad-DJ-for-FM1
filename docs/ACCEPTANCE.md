# FM-1 DJ 0.1.0 acceptance report

[Русская версия](ru/ACCEPTANCE.md)

The local checks ran on macOS 27.2.1 (26B131), Chrome 157.0.8103.79 and Node 24.22.3. The FM-1 DJ package identifier is `FM-1_82000100`. Local Chrome checks used production files served under `/fm1-dj/`. Public checks ran on GitHub Pages over HTTPS. Automation used a silent Web Audio output. All 549 unit and DOM tests and six browser scenarios passed.

| Acceptance test | Result |
| --- | --- |
| 1. Startup | The published page returned HTTP 200 and started in Chrome without a local server. |
| 2. Connection | The host simulator verified Note On/Off, relative MIDI CC, the SysEx exchange and display rendering. No physical FM-1 was detected. |
| 3. Library | The published build imported 10 WAV, MP3 and FLAC test files. Library entries persisted after reload. BPM detection was verified on the test tracks, including MP3 and FLAC. |
| 4. DJ mix | Chrome verified simultaneous playback on both decks, transport controls and BPM matching. Tests cover the audio graph and phase algorithm. A full mix with the FM-1 remains unverified. |
| 5. Independent outputs | The audio graph test verified that there is no PFL-to-Master path. The output selection test rejected using the same device for both. Physical routing and latency remain unverified. |
| 6. 60-minute run | Requires a run on physical hardware. |
| 7. Recovery | The simulator verified USB Audio muting on timeout, disconnect handling and recovery after a new SysEx exchange. A separate test with physical USB is required. |
| 8. Transition quality | Tests verified Equal Power gain control and smooth parameter automation. Listening tests are pending. |
| 9. GitHub Pages | Production files, the analysis Web Worker, local import and playback were checked on [GitHub Pages](https://teutonick.github.io/fm1-dj/). Native Web MIDI and USB Audio checks require an FM-1. |
| 10. Firmware installation | The JieLi toolchain built the `.fwsc` package. The SHA-256 of the downloaded [release](https://github.com/Teutonick/fm1-dj/releases/tag/v0.1.0) matched the local package. Physical installation and restoration of the stock firmware remain unverified. |

For hardware acceptance, first verify A/B routing and latency across both outputs. Then perform a transition with the FM-1, check cable disconnection and finish with a 60-minute run.

Automated tests with virtual ports cover MIDI port matching with different Windows suffixes, manual port selection, SysEx reply validation and reconnection. Use the [Windows checklist](WINDOWS.md) to verify USB MIDI and USB Audio on Windows 11 hardware.
