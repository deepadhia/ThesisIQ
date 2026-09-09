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
git pull origin main

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

# 2. Install any new npm packages
echo "Installing dependencies..."
npm install

# 3. Restart PM2 daemon with updated schedule
echo "Restarting PM2 daemon with 5-minute (8 AM - 11 PM) schedule..."
pm2 delete multibagger-scanner || true
pm2 start backend/scripts/scan-announcements-action.js \
  --name "multibagger-scanner" \
  --node-args="--max-old-space-size=512" \
  --cron "*/5 8-23 * * *" \
  --no-autorestart

# 4. Save PM2 state
pm2 save

echo "================================================================"
echo "✅ Multibagger Live Daemon successfully updated!"
echo "   Monitor logs with: pm2 logs multibagger-scanner"
echo "================================================================"
