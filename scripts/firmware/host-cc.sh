#!/usr/bin/env bash
set -euo pipefail
exec clang -Werror -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer "$@"
