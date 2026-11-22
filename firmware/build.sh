#!/bin/sh
set -eu
cd "$(dirname "$0")"
base_ref=b0c384b21b095fb4f940025ce6ce7348625b4dda
if [ ! -d base/.git ]; then
  git clone https://github.com/charlesvestal/fm1-base.git base
fi
git -C base checkout --detach "$base_ref"
git -C base submodule update --init --recursive
patch=../patches/fm1-base-safety.patch
if git -C base apply --check --reverse "$patch" 2>/dev/null; then
  : # Already applied to this checkout.
else
  git -C base apply "$patch"
fi
exec "${FM1_PYTHON:-python3}" base/tools/build.py dj "$@"
