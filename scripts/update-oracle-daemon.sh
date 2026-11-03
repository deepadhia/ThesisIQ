#!/bin/bash
# =================================================================
# 🚀 Multibagger Live — 1-Click Oracle Server Code Updater
# Pulls latest code from main, updates dependencies, and reloads PM2.
# =================================================================

set -e

echo "================================================================"
echo "🔄 Updating Multibagger Live Daemon on Oracle Server..."
echo "================================================================"

# Navigate to project directory
cd "$(dirname "$0")/.."

# 1. Pull latest code from GitHub
echo "Pulling latest code from origin main..."
PREV_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "initial")
git pull origin main
NEW_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "updated")

# 1b. Ensure system dependencies (ffmpeg) are installed automatically
if ! command -v ffmpeg &> /dev/null; then
  echo "Installing ffmpeg for audio processing..."
  sudo apt-get update -y && sudo apt-get install -y ffmpeg
fi

# 1c. Ensure GEMINI_API_KEY is set in .env.local
if [ -f .env.local ]; then
  if ! grep -q "GEMINI_API_KEY" .env.local; then
    echo "GEMINI_API_KEY is missing from .env.local."
    read -sp "Enter GEMINI_API_KEY: " INPUT_GEMINI_KEY
    echo ""
    echo "GEMINI_API_KEY=${INPUT_GEMINI_KEY}" >> .env.local
    echo "Added GEMINI_API_KEY to .env.local successfully!"
  fi
fi

if [ "$PREV_COMMIT" != "$NEW_COMMIT" ] && git diff --name-only "$PREV_COMMIT" "$NEW_COMMIT" | grep -qE '^package(-lock)?\.json$'; then
  echo "Dependencies changed in package.json. Installing updated production packages..."
  npm install --omit=dev --no-audit --no-fund --prefer-offline
else
  echo "No package.json changes detected. Skipping npm install (fast & zero RAM overhead)."
fi

# 3. Restart PM2 daemon with updated schedule
# PM2 evaluates the cron in the SERVER's timezone. The Oracle box runs in UTC, where "8-23" is 13:30-05:30 IST and the whole
# morning market session (05:30-13:30 IST) was never scanned. The window must be 08:00-23:55 IST whatever the server clock is.
SERVER_TZ=$(date +%Z)
case "$SERVER_TZ" in
  UTC|GMT) SCAN_CRON="*/5 2-18 * * *" ;;   # 02:00-18:55 UTC = 07:30-00:25 IST
  IST)     SCAN_CRON="*/5 8-23 * * *" ;;
  *) echo "❌ Server timezone is '$SERVER_TZ'; set SCAN_CRON for it in this script (window: 08:00-23:55 IST). Aborting."; exit 1 ;;
esac
echo "Restarting PM2 daemon (server timezone $SERVER_TZ, cron '$SCAN_CRON' = about 08:00-23:55 IST)..."
pm2 delete multibagger-scanner || true
pm2 start backend/scripts/scan-announcements-action.js \
  --name "multibagger-scanner" \
  --node-args="--max-old-space-size=512" \
  --cron "$SCAN_CRON" \
  --no-autorestart

# 4. Save PM2 state
pm2 save

echo "================================================================"
echo "✅ Multibagger Live Daemon successfully updated!"
echo "   Monitor logs with: pm2 logs multibagger-scanner"
echo "================================================================"
