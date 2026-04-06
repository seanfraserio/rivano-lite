#!/bin/sh
set -e

CONFIG_FILE="${RIVANO_CONFIG:-/data/rivano.yaml}"
DATA_DIR="${RIVANO_DATA_DIR:-/data}"

# Seed default config if none exists
if [ ! -f "$CONFIG_FILE" ]; then
  echo "[rivano] No config found — seeding defaults..."
  cp /rivano/defaults/rivano.yaml "$CONFIG_FILE"
  echo "[rivano] Created $CONFIG_FILE — edit via WebUI at http://localhost:9000"
fi

# Ensure data directory structure
mkdir -p "$DATA_DIR"

echo "[rivano] Starting Rivano Lite..."
exec bun run /rivano/dist/index.js
