#!/usr/bin/env bash
set -euo pipefail

required=true
if [[ "$GITHUB_EVENT_NAME" != workflow_dispatch &&
      "${GITHUB_REF_TYPE:-}" != tag && -n "${FM1_DIFF_BASE:-}" ]] &&
    git cat-file -e "$FM1_DIFF_BASE^{commit}" && git cat-file -e "$FM1_DIFF_HEAD^{commit}"; then
  paths=(
    firmware src/fm1 src/components/FirmwarePanel.jsx src/components/ConfigDialog.jsx
    src/MiniDJPlayer.jsx src/i18n electron scripts/firmware .github/workflows
    docs/FIRMWARE-SAFETY.md docs/FIRMWARE-SAFETY-GATE.md tests/dom/FirmwarePanel.test.jsx
    tests/dom/FM1Hardware.test.jsx tests/unit/fm1 package.json package-lock.json
    vite.config.js vitest.config.js electron-builder.yml
  )
  if git diff --quiet "$FM1_DIFF_BASE" "$FM1_DIFF_HEAD" -- "${paths[@]}"; then
    required=false
  else
    status=$?
    [[ "$status" == 1 ]] || exit "$status"
  fi
fi
printf 'required=%s\n' "$required" >> "$GITHUB_OUTPUT"
