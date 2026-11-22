"""Exercise the pinned unbricker against in-memory devices only."""

import argparse
import hashlib
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("unbricker", type=Path)
    parser.add_argument("original", type=Path)
    parser.add_argument("cuts", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--staged", action="store_true", help="restore snapshots taken during real OTA app writes")
    args = parser.parse_args()
    sys.path.insert(0, str(args.unbricker.resolve()))
    import fm1_unbrick as tool

    baseline = args.original.read_bytes()
    if len(baseline) != tool.FLASH_SIZE:
        raise ValueError("expected a full baseline Flash dump")
    expected = baseline[tool.FW_START:tool.FW_END]
    args.out.mkdir(parents=True, exist_ok=True)
    results = []
    cuts = sorted(args.cuts.glob("*.bin"))
    count = 4 if args.staged else 12
    if len(cuts) != count:
        raise ValueError(f"expected {count} cut snapshots, got {len(cuts)}")

    for path in cuts:
        snapshot = path.read_bytes()
        if snapshot[tool.FW_START:tool.FW_END] == expected:
            raise ValueError(f"cut snapshot is unchanged: {path.name}")
        jedec = int(path.name.split("-")[0], 16)
        model = tool.MockUboot(image=snapshot, flash_id=jedec)
        device = tool.Fm1Device("mock://fm1-uboot", model, io_max=model.usb_buffer_size(), mock=True)
        if device.flash_id() != jedec:
            raise RuntimeError(f"incorrect model: {path.name}")
        if not tool.write_and_verify(device, expected):
            raise RuntimeError(f"mock restoration failed: {path.name}")
        wanted = snapshot[:tool.FW_START] + expected + snapshot[tool.FW_END:] if args.staged else baseline
        if bytes(model.flash) != wanted or model.lowest_touched() != tool.FW_START:
            raise RuntimeError(f"unexpected Flash content or write range: {path.name}")
        results.append({"snapshot": path.name, "jedec": f"{jedec:06x}", "restored": True})
        if len(results) == 1:
            (args.out / "restored.bin").write_bytes(model.flash)
    (args.out / "rom-mock.json").write_text(json.dumps({
        "transport": "MockUboot",
        "input": "interrupted OTA app write" if args.staged else "interrupted SPI sector",
        "sha256": hashlib.sha256(baseline).hexdigest(),
        "cases": results,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"Mock ROM restoration: {len(results)} full-image comparisons passed")


if __name__ == "__main__":
    main()
