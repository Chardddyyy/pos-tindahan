#!/usr/bin/env bash
# Mac / Linux:   ./simula.sh            (local computer)
#                ./simula.sh --https    (to use mobile device camera on same WiFi)
set -e
cd "$(dirname "$0")"

if [ ! -x ".venv/bin/python" ]; then
  echo "First-time setup: installing dependencies..."
  python3 -m venv .venv
  .venv/bin/python -m pip install -r requirements.txt
fi

exec .venv/bin/python run.py "$@"

