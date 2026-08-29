#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT=${PORT:-4173}

echo "Serving $ROOT_DIR/game at http://127.0.0.1:$PORT"
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT_DIR/game"
