#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

check=scripts/firmware/safety.mjs
dir="$PWD/firmware/dj/build"
report="${FM1_SAFETY_REPORT_DIR:-$dir/safety}"
deps="${FM1_SAFETY_TOOLS:-$dir/safety-tools}"
mkdir -p "$report" "$deps"
export FM1_SAFETY_REPORT_DIR="$report"
version=$(node "$check" version)
candidate="${FM1_CANDIDATE_FILE:-$dir/fm1-dj-$version.fwsc}"
export FM1_CANDIDATE_FILE="$candidate"

fetch() {
  local repo="$1" rev="$2" target="$3"
  if [[ ! -d "$target/.git" ]]; then
    git init -q "$target"
    git -C "$target" fetch --depth 1 "https://github.com/$repo.git" "$rev"
    git -C "$target" checkout --detach "$rev"
  fi
  [[ "$(git -C "$target" rev-parse HEAD)" == "$rev" ]]
  [[ -z "$(git -C "$target" status --porcelain --untracked-files=no)" ]]
}

case "${1:-}" in
  all)
    if [[ "$(uname -s)" == Linux ]]; then
      bash "$0" build
      bash "$0" host
      bash "$0" prepare-emulator
      bash "$0" emulator
      bash "$0" installer
    elif [[ "$(uname -s)" == Darwin ]]; then
      bash "$0" prepare-fm1kit
      bash "$0" package
    else
      echo "Run the target and emulator stages on Linux and FM1Kit on macOS, or use GitHub Actions." >&2
      exit 1
    fi
    echo "The complete gate requires both runners and all mandatory evidence. Run GitHub Actions for the aggregate report." >&2
    bash "$0" recovery
    ;;
  build)
    [[ "$(uname -s)" == Linux ]] || { echo "Target gate requires Linux with the JieLi toolchain."; exit 1; }
    sh firmware/build.sh --host 2>&1 | tee "$report/build-host.log"
    firmware/base/tools/setup_toolchain.sh --only jieli,ac79-sdk 2>&1 | tee "$report/sdk.log"
    sh firmware/build.sh --release "$version" 2>&1 | tee "$report/build.log"
    node "$check" package
    ;;
  host|static)
    command -v clang >/dev/null
    chmod +x scripts/firmware/host-cc.sh
    CC="$PWD/scripts/firmware/host-cc.sh" sh firmware/build.sh --host 2>&1 | tee "$report/host-build.log"
    if [[ "$1" == host ]]; then
      node firmware/test-host.mjs 2>&1 | tee "$report/host-tests.log"
      (
        cd firmware/base/bsp
        CC=clang bash tests/run_flash_wait_test.sh
        CC=clang bash tests/run_flash_tests.sh
      ) 2>&1 | tee "$report/bsp-flash.log"
    fi
    ;;
  prepare-fm1kit)
    [[ "$(uname -s)" == Darwin ]] || { echo "FM1Kit requires macOS and the pinned Xcode."; exit 1; }
    export DEVELOPER_DIR="/Applications/Xcode_$(node "$check" pin xcode).app/Contents/Developer"
    xcrun swift --version
    fetch ocean/FM1Kit "$(node "$check" pin fm1kit)" "$deps/FM1Kit"
    (cd "$deps/FM1Kit" && xcrun swift build -c release --product fm1probe) 2>&1 | tee "$report/fm1kit-build.log"
    ;;
  package)
    probe="$deps/FM1Kit/.build/release/fm1probe"
    [[ -x "$probe" ]] || { echo "Run the prepare-fm1kit stage first."; exit 1; }
    "$probe" inspect "$candidate" --json > "$report/fm1kit-inspect.json"
    "$probe" check "$candidate" --strict --json > "$report/fm1kit.json"
    baseline=$(node "$check" pin baseline)
    old="$deps/fm1-dj-$baseline.fwsc"
    curl --fail --silent --show-error --location \
      "https://github.com/Teutonick/NotBad-DJ-for-FM1/releases/download/v$baseline/fm1-dj-$baseline.fwsc" --output "$old"
    node "$check" baseline "$old"
    "$probe" diff "$old" "$candidate" --json > "$report/fm1kit-diff.json"
    ;;
  prepare-emulator)
    [[ "$(uname -s)/$(uname -m)" == Linux/x86_64 ]] || { echo "Pinned emulator download requires Linux x86-64."; exit 1; }
    emu_version=$(node "$check" pin emulator)
    name="fm1-emu-$emu_version-linux-x86_64"
    archive="$deps/$name.tar.gz"
    curl --fail --silent --show-error --location \
      "https://github.com/joakimeriksson/fm1-emu/releases/download/v$emu_version/$name.tar.gz" --output "$archive"
    printf '%s  %s\n' "$(node "$check" pin emulatorLinuxSha256)" "$archive" | shasum -a 256 --check
    mkdir -p "$deps/fm1-emu"
    tar -xzf "$archive" --strip-components=1 -C "$deps/fm1-emu"
    "$deps/fm1-emu/fm1-live" --version
    ;;
  emulator)
    binary="${FM1_LIVE_BIN:-$deps/fm1-emu/fm1-live}"
    [[ -x "$binary" ]] || { echo "Run the prepare-emulator stage first."; exit 1; }
    chips=(p25q80 uc25hq80)
    if [[ $# == 2 ]]; then chips=("$2"); fi
    for chip in "${chips[@]}"; do
      [[ "$chip" == p25q80 || "$chip" == uc25hq80 ]]
      node scripts/firmware/emulator.mjs "$binary" "$candidate" "$chip" "$version" "$report/$chip"
    done
    ;;
  installer)
    node --test scripts/firmware/safety.test.mjs 2>&1 | tee "$report/gate-self-tests.log"
    npm test -- tests/dom/FirmwarePanel.test.jsx tests/unit/fm1/otaWire.test.js 2>&1 | tee "$report/installer-tests.log"
    npm run build 2>&1 | tee "$report/web-build.log"
    test -f docs/FIRMWARE-SAFETY.md
    ;;
  recovery)
    echo "NOT VERIFIED: full emulator Flash power-loss and OTA/ROM recovery workloads are still required." >&2
    exit 1
    ;;
  *)
    echo "Usage: safety.sh build|static|host|prepare-fm1kit|package|prepare-emulator|emulator|installer|recovery" >&2
    exit 2
    ;;
esac
