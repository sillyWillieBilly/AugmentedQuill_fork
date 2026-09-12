#!/usr/bin/env bash
# Copyright (C) 2026 AugmentedQuill contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Purpose: Launch only this checkout's web app with isolated local runtime data.
set -euo pipefail
writer_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$writer_root"
export AUGQ_USER_DATA_DIR="$writer_root/.local-data"
export AUGQ_PROJECTS_ROOT="$AUGQ_USER_DATA_DIR/projects"
export AUGQ_PROJECTS_REGISTRY="$AUGQ_USER_DATA_DIR/config/projects.json"
export AUGQ_MACHINE_CONFIG_PATH="$AUGQ_USER_DATA_DIR/config/machine.json"
export VITE_BACKEND_URL="http://127.0.0.1:28000"
if [[ "${1:-dev}" == types ]]; then
  venv/bin/python tools/export_openapi.py
  exec npm --prefix src/frontend run generate:types
fi
if [[ "${1:-dev}" == run ]]; then
  exec venv/bin/python -m augmentedquill.main --host 127.0.0.1 --port 28000
fi
if [[ "${1:-dev}" != dev ]]; then
  printf 'Usage: bash tools/writer-dev.sh [dev|run|types]\n' >&2
  exit 2
fi
venv/bin/python -m augmentedquill.main --host 127.0.0.1 --port 28000 &
writer_backend_pid=$!
trap 'kill "$writer_backend_pid" 2>/dev/null || true; wait "$writer_backend_pid" 2>/dev/null || true' EXIT
trap 'exit 130' INT TERM
npm --prefix src/frontend run dev -- --host 127.0.0.1 --port 28001 --strictPort
