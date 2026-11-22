#!/usr/bin/env bash
# Inputs are pinned source checkouts and a local .fwsc. No access to USB/MIDI devices.
set -euo pipefail

emu=$(cd "$1" && pwd)
unbricker=$(cd "$2" && pwd)
base=$(cd "$3" && pwd)
candidate="$4"
reports="$5"
scripts="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$reports"
work=$(mktemp -d "$reports/lab.XXXXXX")
mkdir -p "$work/crates" "$work/peer/src" "$work/spi" "$work/cuts" "$work/app-cuts"
for crate in fm1-isa fm1-core fm1-soc; do
  cp -R "$emu/crates/$crate" "$work/crates/"
done
cat > "$work/Cargo.toml" <<'EOF'
[workspace]
resolver = "2"
members = ["crates/fm1-isa", "crates/fm1-core", "crates/fm1-soc", "peer"]
[workspace.package]
version = "0.5.1"
edition = "2021"
license = "MIT"
EOF
cat > "$work/peer/Cargo.toml" <<'EOF'
[package]
name = "peer"
version.workspace = true
edition.workspace = true
[dependencies]
fm1-core = { path = "../crates/fm1-core" }
fm1-soc = { path = "../crates/fm1-soc" }
EOF
cp "$scripts/ota-emulator.rs" "$work/peer/src/main.rs"
cp "$scripts/spi-cut.rs" "$work/spi/main.rs"
cp "$emu/crates/fm1-soc/src/spiflash.rs" "$work/spi/"
rustc --edition 2021 -O "$work/spi/main.rs" -o "$work/spi-cut"
cargo build --offline --release --manifest-path "$work/Cargo.toml"

peer="$work/target/release/peer"
unset FM1_FLASH_CUT FM1_OTA_FAST
"$peer" "$candidate" p25q80 seed "$work/original.bin"
"$work/spi-cut" "$work/original.bin" "$work/cuts"
python "$scripts/rom-recovery.py" "$unbricker" "$work/original.bin" "$work/cuts" "$reports"
"$peer" "$candidate" p25q80 probe "$reports/restored.bin"

for chip in p25q80 uc25hq80; do
  metrics=$("$peer" "$candidate" "$chip" stage "$work/$chip-staged.bin")
  echo "$chip $metrics"
  ops=$(sed -n 's/.* ops=\([0-9][0-9]*\) .*/\1/p' <<< "$metrics")
  [[ "$ops" =~ ^[0-9]+$ && "$ops" -ge 5 ]]
  for cut in 1 2 "$((ops / 2))" "$((ops - 1))" "$ops"; do
    echo "$chip OTA staging cut $cut/$ops"
    snapshot="$work/$chip-$cut.bin"
    FM1_FLASH_CUT=$cut "$peer" "$candidate" "$chip" stage "$snapshot"
    "$peer" "$candidate" "$chip" probe "$snapshot"
  done
  loader="$work/$chip-loader.bin"
  damaged="$work/$chip-damaged.bin"
  python "$scripts/unpack-loader.py" "$base" "$work/$chip-staged.bin" "$loader" "$damaged"
  "$peer" "$candidate" "$chip" loader "$work/$chip-written.bin" "$damaged" "$loader"
  if [[ "$chip" == p25q80 ]]; then jedec=856014; else jedec=b36014; fi
  for cut in 1 2; do
    echo "$chip app write cut $cut and loader resume"
    snapshot="$work/app-cuts/$jedec-app-cut-$cut.bin"
    resumed="$work/$chip-app-resumed-$cut.bin"
    FM1_FLASH_CUT=$cut "$peer" "$candidate" "$chip" loader "$snapshot" "$damaged" "$loader"
    "$peer" "$candidate" "$chip" loader "$resumed" "$snapshot" "$loader"
    "$peer" "$candidate" "$chip" probe "$resumed"
  done

  # Discover the number of operations from the same package and chip, including
  # completion bookkeeping. Every case starts with the same two damaged sectors.
  metrics=$(FM1_OTA_FAST=1 "$peer" "$candidate" "$chip" loader "$work/$chip-fast-written.bin" "$damaged" "$loader")
  echo "$chip fast loader $metrics"
  ops=$(sed -n 's/.* ops=\([0-9][0-9]*\) .*/\1/p' <<< "$metrics")
  [[ "$ops" =~ ^[0-9]+$ && "$ops" -ge 35 ]]
  for ((cut = 1; cut <= ops; cut++)); do
    echo "$chip fast loader cut $cut/$ops"
    snapshot="$work/$chip-fast-cut.bin"
    resumed="$work/$chip-fast-resumed.bin"
    FM1_OTA_FAST=1 FM1_FLASH_CUT=$cut "$peer" "$candidate" "$chip" loader "$snapshot" "$damaged" "$loader"
    FM1_OTA_FAST=1 "$peer" "$candidate" "$chip" loader "$resumed" "$snapshot" "$loader"
    "$peer" "$candidate" "$chip" probe "$resumed"
  done
  echo "$chip fast loader matrix: $ops/$ops passed"
done
python "$scripts/rom-recovery.py" "$unbricker" "$work/original.bin" "$work/app-cuts" "$reports/ota-rom" --staged
echo "Partial recovery evidence collected. SPL handoff and on-device ROM are not covered."