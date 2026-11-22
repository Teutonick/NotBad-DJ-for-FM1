# FM‑1 firmware safety

[Русская версия](ru/FIRMWARE-SAFETY.md)

**Settings → Firmware** provides read-only diagnostics. For release 0.1.0, the [release manifest](../src/fm1/updater/releases.json) records the package SHA-256, its identifier and the pinned fm1-base and felucca-bsp revisions. The known JEDEC IDs are `856014` (Puya P25Q80H) and `B36014` (UCUN UC25HQ80). The owner reports physical checks of 0.1.0 only on the Puya P25Q80H with JEDEC ID `856014` and m-bootloader 2.3. Other combinations are unverified and may cause device problems. The stock firmware version, OTA reply and MIDI port name alone cannot identify the chip or installed bootloader. [JEDEC validation in fm1-base](https://github.com/charlesvestal/fm1-base/blob/b0c384b21b095fb4f940025ce6ce7348625b4dda/device/fm1_flash_ok.h)

## Diagnostics and backup

1. Fully charge the FM‑1, connect it directly with a working USB data cable, disable computer sleep, and close other MIDI apps. Keep only one controller connected.
2. Run [M-Flasher](https://github.com/jvitkauskas/m-flasher) in diagnostic mode and save the available **Device Info**. Record the JEDEC ID, Flash capacity, current firmware and bootloader. Mark unavailable information as unknown. The Firmware tab recognizes the entered JEDEC ID. The MIDI probe shows the identifier reported by the device and the JEDEC ID when the firmware includes it in the extended reply. [BSP reply format](https://github.com/hugelton/felucca-bsp/blob/7b77bfbce8e0d185461a79d164c893551492ded1/chip/ota.c#L153-L181)
3. Read the entire Flash twice independently from the same device, 1 MiB per read. Save both files in a separate folder and select them in the Firmware tab. It compares them byte for byte and displays the SHA-256 when they match. Keep the hash with the dumps and the hardware report. A match verifies the file contents. Use diagnostic evidence to confirm their origin and that the reads were independent.
4. Download the matching stock package from [M‑VAVE](https://www.m-vave.com/download) and save it with the original version information. V15 and V16 use different Flash maps. Confirm the version before choosing a procedure. [FM1 Unbricker guide](https://quixotic7.github.io/MvaveFM1Unbricker/)
5. Select the 0.1.0 package from the [release](https://github.com/Teutonick/NotBad-DJ-for-FM1/releases/tag/v0.1.0). The app checks the identifier, SHA-256, package structure and internal UFW checksums. [FWSC format](https://sbegueria.github.io/fm1-dev-wiki/Firmware-Package-Format.html)

## Recovery

- **The device boots normally.** Save a current Flash dump and confirm that a suitable recovery tool is available.
- **Only the OTA MIDI port appears.** Maintain power, identify the bootloader, and follow the guide for that version. Resuming a write requires a package compatible with that bootloader. [OTA protocol](https://sbegueria.github.io/fm1-dev-wiki/Update-Protocol-and-Installers.html)
- **The device appears as `WL82 UBOOT1.00`.** Follow the ROM instructions for that chip revision. For full recovery, use a verified dump from that unit and a tool that supports its JEDEC ID and verifies the data it writes. [FM1 Unbricker](https://quixotic7.github.io/MvaveFM1Unbricker/)
- **No USB device appears.** Check power and the direct USB connection. If USB is still unavailable, follow the ROM-entry procedure. [FM1 Unbricker](https://quixotic7.github.io/MvaveFM1Unbricker/)

USB MIDI can read the firmware identifier and serve OTA package read requests. The pinned OTA loader reads back the written sectors and compares the bytes on the device. Independent Flash verification on the host and full-dump restoration require a separate transport. [BSP sector verification](https://github.com/hugelton/felucca-bsp/blob/7b77bfbce8e0d185461a79d164c893551492ded1/loader/ldr_core.c#L182-L197)

A power interruption can remove the USB MIDI port and require manual ROM entry. The app does not retry writes or roll back on timeout. [OTA protocol](https://sbegueria.github.io/fm1-dev-wiki/Update-Protocol-and-Installers.html)

## Requirements for write and automatic rollback approval

For every approved configuration, record the JEDEC ID, original firmware, bootloader, Flash map, package SHA-256, tool versions and physical FM‑1 test results. Establish a way to verify these details and confirm that the backup came from the connected unit. Test recovery on a dedicated device with ROM entry prepared.

Record interruption test results for OTA preparation, loader startup, erase, write, verification and restart. Compare Flash readback after writing with the expected ranges of the image. After restarting, check the display, controls, USB MIDI, USB Audio and the availability of the update path without starting another write. Enable automatic rollback only when the recovery tool confirms the device identity, write access and Flash map variant. Use the recovery assistant for other states.

Every new release follows the [Firmware Safety Gate](FIRMWARE-SAFETY-GATE.md).
