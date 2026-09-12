#!/usr/bin/env bash
# Copyright (C) 2026 AugmentedQuill contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Purpose: Start the local writer once and open its ready interface in Brave.
set -euo pipefail

writer_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
writer_url="http://127.0.0.1:28000"
writer_data="$writer_root/.local-data"
writer_log="$writer_data/logs/launcher.log"

fail() {
  printf 'AugmentedQuill Writer: %s\n' "$1" >&2
  if command -v notify-send >/dev/null 2>&1; then
    notify-send --app-name='AugmentedQuill Writer' --urgency=critical \
      'Could not open the writing workspace' "$1" || true
  fi
  exit 1
}

for writer_command in curl flock nohup; do
  command -v "$writer_command" >/dev/null 2>&1 || fail "Missing command: $writer_command"
done
writer_brave=''
for writer_candidate in brave-browser brave-browser-stable brave; do
  if command -v "$writer_candidate" >/dev/null 2>&1; then
    writer_brave="$(command -v "$writer_candidate")"
    break
  fi
done
[[ -n "$writer_brave" ]] || fail 'Brave is not installed or is not on PATH.'

mkdir -p "$writer_data/logs"
cd "$writer_root"

ready() {
  curl --noproxy '*' --fail --silent --connect-timeout 1 --max-time 2 \
    "$writer_url/api/v1/health" >/dev/null &&
    curl --noproxy '*' --fail --silent --connect-timeout 1 --max-time 2 \
      "$writer_url/static/dist/index.html" >/dev/null
}

# Repeated clicks must not start competing servers. Background children close
# this descriptor so the launch lock is released when this script finishes.
exec 9>"$writer_data/launcher.lock"
flock --wait 120 9 || fail "Another launch is still busy. See $writer_log"

if ! ready; then
  [[ -x "$writer_root/venv/bin/python" ]] ||
    fail "Run 'make setup' in $writer_root first."
  if [[ ! -s "$writer_root/static/dist/index.html" ]]; then
    command -v npm >/dev/null 2>&1 || fail 'npm is needed to build the missing frontend.'
    npm --prefix src/frontend run build >>"$writer_log" 2>&1 ||
      fail "The frontend build failed. See $writer_log"
  fi

  nohup bash "$writer_root/tools/writer-dev.sh" run \
    </dev/null >>"$writer_log" 2>&1 9>&- &
  writer_pid=$!
  printf '%s\n' "$writer_pid" >"$writer_data/launcher.pid"
  writer_deadline=$((SECONDS + 60))
  until ready; do
    kill -0 "$writer_pid" 2>/dev/null || fail "The server could not start. See $writer_log"
    (( SECONDS < writer_deadline )) || fail "The server is taking too long to start. See $writer_log"
    sleep 0.25
  done
fi

flock --unlock 9
exec 9>&-
nohup "$writer_brave" --new-window "$writer_url/" \
  </dev/null >>"$writer_data/logs/brave-launcher.log" 2>&1 &
