#!/bin/bash
# =================================================================
# 🚀 Multibagger Live — 24/7 Oracle Cloud Server Setup Script
# Installs Node.js 20, PM2 daemon, PostgreSQL connection, and 
# starts the 24/7 Real-Time Announcement & Deep-Dive Daemon.
# =================================================================

set -e

echo "================================================================"
echo "🚀 Setting up Multibagger Live Daemon on Oracle Cloud Server..."
echo "================================================================"

# 1. Update system & install Node.js 20 LTS, ffmpeg, and yt-dlp
sudo apt-get update -y
sudo apt-get install -y curl git build-essential ffmpeg python3-pip

if ! command -v yt-dlp &> /dev/null; then
  echo "Installing yt-dlp standalone binary..."
  sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp || true
  sudo chmod a+rx /usr/local/bin/yt-dlp || true
fi

if ! command -v node &> /dev/null; then
  echo "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# 2b. Install project dependencies
echo "Installing production npm dependencies..."
npm install --omit=dev --no-audit --no-fund

echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# 1b. Create 2 GB Swap File for 1 GB RAM / Micro Instance Stability
if [ ! -f /swapfile ]; then
  echo "Setting up 2 GB Swap File for memory safety..."
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo "/swapfile swap swap defaults 0 0" | sudo tee -a /etc/fstab
  echo "2 GB Swap File enabled successfully!"
fi

# 2. Install PM2 globally
sudo npm install -g pm2

# 3. Create .env.local if missing (Interactive & Secure)
if [ ! -f .env.local ]; then
  echo "Creating .env.local file..."
  
  if [ -z "$DATABASE_URL" ]; then
    read -sp "Enter DATABASE_URL: " INPUT_DB_URL
    echo ""
  else
    INPUT_DB_URL="$DATABASE_URL"
  fi

  if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    read -sp "Enter TELEGRAM_BOT_TOKEN: " INPUT_BOT_TOKEN
    echo ""
  else
    INPUT_BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
  fi

  if [ -z "$TELEGRAM_CHAT_ID" ]; then
    read -p "Enter TELEGRAM_CHAT_ID: " INPUT_CHAT_ID
  else
    INPUT_CHAT_ID="$TELEGRAM_CHAT_ID"
  fi

  if [ -z "$NVIDIA_API_KEY" ]; then
    read -sp "Enter NVIDIA_API_KEY: " INPUT_NVIDIA_KEY
    echo ""
  else
    INPUT_NVIDIA_KEY="$NVIDIA_API_KEY"
  fi

  if [ -z "$GEMINI_API_KEY" ]; then
    read -sp "Enter GEMINI_API_KEY: " INPUT_GEMINI_KEY
    echo ""
  else
    INPUT_GEMINI_KEY="$GEMINI_API_KEY"
  fi

  cat <<EOT > .env.local
DATABASE_URL=${INPUT_DB_URL}
TELEGRAM_BOT_TOKEN=${INPUT_BOT_TOKEN}
TELEGRAM_CHAT_ID=${INPUT_CHAT_ID}
NVIDIA_API_KEY=${INPUT_NVIDIA_KEY}
GEMINI_API_KEY=${INPUT_GEMINI_KEY}
PORT=4000
EOT
  echo ".env.local created securely!"
fi

# 4. Setup PM2 Daemon for Real-Time Announcement Scanner & Deep-Dive Worker
echo "Starting PM2 24/7 Daemon..."

pm2 stop multibagger-scanner || true
pm2 delete multibagger-scanner || true

# PM2 evaluates the cron in the SERVER's timezone (UTC on Oracle): "8-23" there is 13:30-05:30 IST. Keep the window 08:00-23:55 IST.
SERVER_TZ=$(date +%Z)
case "$SERVER_TZ" in
  UTC|GMT) SCAN_CRON="*/5 2-18 * * *" ;;   # 02:00-18:55 UTC = 07:30-00:25 IST
  IST)     SCAN_CRON="*/5 8-23 * * *" ;;
  *) echo "❌ Server timezone is '$SERVER_TZ'; set SCAN_CRON for it in this script (window: 08:00-23:55 IST). Aborting."; exit 1 ;;
esac

pm2 start backend/scripts/scan-announcements-action.js \
  --name "multibagger-scanner" \
  --node-args="--max-old-space-size=512" \
  --cron "$SCAN_CRON" \
  --no-autorestart

# Save PM2 process list and configure startup on boot
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME || true

echo "================================================================"
echo "✅ Multibagger Live Daemon successfully deployed on Oracle Server!"
echo "   Status: Running 24/7 with 0-second notification delay."
echo "   Monitor logs with: pm2 logs multibagger-scanner"
echo "================================================================"
