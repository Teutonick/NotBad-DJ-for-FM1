# Firmware Safety Gate

[Русская версия](ru/FIRMWARE-SAFETY-GATE.md)

Changes to the firmware, its dependencies, the MIDI protocol or the installer trigger [GitHub Actions checks](../.github/workflows/firmware-safety.yml). The shared workflow calls these checks for pull requests, merge queue runs, pushes, tags and manual runs. If the diff only touches files outside the firmware scope, the change detection step reports `not applicable`. Manual runs and tags always run the full suite.

## Checks

| Stage | What it verifies |
| --- | --- |
| Target build | Pinned fm1-base and BSP revisions, builder checks, package identifier, structure, CRC, image boundary, and SHA-256 hashes of the boot area and OTA loader against the accepted Flash map. |
| Host Simulator | Clang with `-Werror`, ASan and UBSan, USB MIDI and audio disconnect tests, deterministic malformed SysEx cases, and BSP Flash tests. |
| FM1Kit on macOS | Independent `inspect`, `check --strict --json` and `diff` checks with the saved SHA-256 of the previous release. |
| fm1-emu | The same `.fwsc` in normal and strict modes on Puya and UCUN. Checks USB MIDI replies, input, display and Flash state after restart. |
| Installer | Read-only diagnostics, USB disconnect handling, negative package tests, and simulated OTA packet exchanges for interruptions, resumption and detection of a different bootloader. |

[toolchain.json](../scripts/firmware/toolchain.json) pins FM1Kit revisions and tool versions. FM1Kit builds from the specified commit using Xcode 26.2. CI uses the Linux archive of fm1-emu 0.5.1 with a pinned SHA-256. The gate checks fm1-base and BSP revisions against the [release manifest](../src/fm1/updater/releases.json). When a tool, Flash map or boot area changes, inspect the diff and update the corresponding pin in a separate, reviewable change.

## Automated coverage

The gate enables fm1-base `stack_check` through `FM1B_STACK_CHECK=1`. A [patch](../firmware/patches/fm1-base-safety.patch) to the pinned fm1-base revision generates optimized LLVM IR with the same flags as the object files and moves second-core simulation variables into the corresponding host build branch. The gate requires results for both the main and interrupt stacks. Strict runs of restored images and images from interrupted writes also check observable CPU and bus error flags at startup and when replying over USB MIDI. This scenario covers only a subset of MMIO accesses.

The `recovery_lab` job runs the actual binary in fm1-emu's CPU and USB models and tests interrupted OTA preparation on both Flash models. After each interruption, it compares bytes outside staging and checks that the saved Flash can boot again. The SPI NOR test also exercises all 17 erase and program cut points at two application-region boundaries for each chip. Twelve resulting images are restored through FM1 Unbricker's `MockUboot`, with a byte-for-byte comparison of the entire Flash. The restored image then boots in strict mode.

For the second stage, the harness extracts the actual loader from staging, checks its checksum and loads it into RAM at the SPL address. It deliberately changes two application sectors, interrupts actual erase and write operations, and restarts the loader with the damaged Flash. The scenario passes only if the entire application slot matches the package and protected regions remain intact. The same damaged images are passed to `MockUboot` to test that recovery path independently.

The harness also negotiates fast mode with the actual OTA loader as the web client does and replies with a sector checksum table. For the scenario with two damaged boundary sectors, it first counts operations in a successful run, then simulates a disconnect at each operation, including completion. It restarts the loader and firmware after each disconnect and checks the exact slot contents, protected regions and full firmware identifier. The published 0.1.0 package is expected to yield 35 cut points per chip. The report records this evidence in `fast-loader-cut-matrix`.

Automatic handoff from m-bootloader 2.3 to the OTA loader, a full-slot rewrite matrix and entry into the actual ROM remain `NOT VERIFIED`. The current fm1-emu starts at the application and models the parameters passed by the SPL. The `MockUboot` test verifies the recovery algorithm and range protection in memory. ROM entry and physical USB communication fall outside this scenario. In a separate experiment, the published [m-bootloader 2.3](https://github.com/jvitkauskas/m-bootloader/releases/tag/v2.3) ran from the SPL RAM address with the OTA record from the staging image. It wrote `usb_update_mode` and requested a reset in the model. The actual reset, subsequent USB Download Mode and behavior on a physical FM-1 remain unverified.

A `FAIL`, skipped required stage or missing required result yields `SAFETY FAILED`. A changed image requires a new version and a manifest entry with its own SHA-256. A build with no manifest entry receives `NOT VERIFIED` for release integrity. A mismatch yields `FAIL` at that stage. If the package structure is valid, the package remains available as a temporary artifact for FM1Kit and the emulators. Both outcomes block publishing. CI builds one package and verifies its SHA-256 on every runner. The GitHub Actions artifacts include `report.json`, `report.md`, stage logs and checksums, including on failure.

The owner reports physical testing of 0.1.0 only on **Puya P25Q80H `0x856014` with m-bootloader 2.3**. Emulation also covers UCUN `0xB36014`. A release needs a hardware report that records the original firmware, JEDEC ID, bootloader, SHA-256 of the exact tested package and a verified recovery method. An automated `PREFLASH CANDIDATE` result means the required CI checks passed and the artifact can proceed to hardware acceptance. The report records the limits of emulation. The owner records the hardware acceptance result and the decision to publish. [Diagnostics and recovery guide](FIRMWARE-SAFETY.md)

## Running the checks

On Linux x86-64, install Node.js 24, Python 3.12 with Pillow 12.2.0, Clang and the JieLi and emulator dependencies listed in the workflow. Run `npm ci --ignore-scripts`. On Linux and macOS, `npm run firmware:safety` runs the stages for the current platform. Use CI for the overall status.

```bash
# Linux
bash scripts/firmware/safety.sh build
npm run firmware:safety:static
npm run firmware:safety:host
bash scripts/firmware/safety.sh prepare-emulator
npm run firmware:safety:emulator
bash scripts/firmware/safety.sh installer
bash scripts/firmware/safety.sh recovery-lab # Rust 1.98.0 and Python 3.12

# macOS with Xcode 26.2. Point to the same package built on Linux.
bash scripts/firmware/safety.sh prepare-fm1kit
FM1_CANDIDATE_FILE=/absolute/path/fm1-dj-0.1.0.fwsc npm run firmware:safety:package
```

`npm run firmware:safety:recovery` runs the software test harness and succeeds when the implemented scenarios pass. The log shows the limits of its coverage. Run the portable approval-rules test with `node --test scripts/firmware/safety.test.mjs`.

## Publishing and branch protection

1. After the first run, make the actual **firmware-safety / Firmware Safety Gate** check required in GitHub Rulesets for `main` and restrict bypasses. Require review for changes to workflows, gate scripts and the manifest.
2. Configure the `firmware-release` environment with required reviewers and permitted release tags. Limit publishing access through the GitHub UI and tokens to the people responsible for releases. The workflow check only applies to releases published through the workflow.
3. Download `firmware-under-test` from a successful run and compare its SHA-256 with `report.md`. After hardware acceptance, save the report under `docs/` and add `jedec`, `bootloader`, `sourceFirmware`, `evidence: "hardware-test-report"`, `firmwareSha256`, `recoveryVerified: true` and `reportPath` to the release's `verifiedConfigurations`. Record the same SHA-256 in the report. Then create a version tag on protected `main`. To publish, run **Web checks and GitHub Pages** on that tag with `publish_firmware`. The job depends on the gate, checks that the tag matches the manifest and that the hardware report exists, and uploads the verified CI artifact without rebuilding it. Existing releases are kept intact.
4. If the gate fails, review the artifacts and correct the cause. Pages waits for the gate to pass, so a failed run leaves the last deployment in place.

Configure branch protection and environment rules on GitHub.
