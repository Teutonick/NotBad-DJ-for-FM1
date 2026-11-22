"""Extract the staged loader for direct execution at its ROM load address."""
import argparse
import binascii
import struct
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", type=Path)
    parser.add_argument("staged", type=Path)
    parser.add_argument("loader", type=Path)
    parser.add_argument("damaged", type=Path)
    args = parser.parse_args()
    sys.path.insert(0, str(args.base.resolve() / "tools"))
    from lz4blk import decompress

    flash = bytearray(args.staged.read_bytes())
    if len(flash) != 0x100000:
        raise ValueError("expected a full staged Flash dump")
    staged = flash[0xE0000:0xE4F00]
    checksum, total, address = struct.unpack_from("<HII", staged, 34)
    if not 18 <= total <= 0x14000 or address != 0x01C0A800:
        raise ValueError("invalid staged loader header")
    data = bytearray()
    position = 64
    while len(data) < total:
        compressed, expanded = struct.unpack_from("<II", staged, position)
        position += 8
        if not 1 <= compressed <= 4096 or position + compressed > len(staged):
            raise ValueError("invalid compressed block")
        block = decompress(staged[position:position + compressed])
        if len(block) != expanded or expanded > 4096:
            raise ValueError("invalid decompressed block")
        data.extend(block)
        position += compressed
    if len(data) != total or binascii.crc_hqx(data, 0) != checksum:
        raise ValueError("staged loader checksum mismatch")
    args.loader.write_bytes(data)
    # Force writes at both ends of the app slot even when reinstalling the same package.
    flash[0x4020] ^= 0x80
    flash[0x92FE0] ^= 0x80
    args.damaged.write_bytes(flash)


if __name__ == "__main__":
    main()
