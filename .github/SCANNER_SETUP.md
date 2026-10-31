# GitHub Actions Setup Guide — Announcement Scanner

## Required: Add GitHub Secrets

Go to your repo on GitHub:
**Settings → Secrets and variables → Actions → New repository secret**

Add these (the three LLM keys are all free; at least one is required, all three give the best reliability):

| Secret Name | Where to find it |
|---|---|
| `DATABASE_URL` | Your Supabase/Neon/Railway connection string (same as `.env.local`) |
| `JWT_SECRET` | Same as `.env.local` — any hex string works |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com/keys) — free key (`gsk_…`); first in the LLM failover chain |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com/apikey) — free key; LLM failover + scanned-PDF OCR + concall audio |
| `NVIDIA_API_KEY` | [platform.nvidia.com](https://platform.nvidia.com) — NIM API key (last-resort provider; any ONE of the three LLM keys is enough to run) |
| `TELEGRAM_BOT_TOKEN` | From @BotFather on Telegram |
| `TELEGRAM_CHAT_ID` | Your personal or group chat ID |

> **Note:** `JWT_SECRET` is required because `backend/config/env.js` validates it at startup.
> The scanner itself doesn't use JWT — but it's needed to pass the env validation.

---

## Workflow Schedule (Automatic)

The scanner runs automatically on weekdays (Mon–Fri):

| Run | IST Time | UTC Cron |
|-----|----------|----------|
| Pre-open / Opening bell | 9:00 AM | `30 3 * * 1-5` |
| Mid-morning sweep | 11:00 AM | `30 5 * * 1-5` |
| Post-lunch sweep | 1:30 PM | `0 8 * * 1-5` |
| Market close sweep | 3:30 PM | `0 10 * * 1-5` |

---

## Manual Trigger (On-Demand)

Go to: **Actions → 📢 Corporate Announcement Scanner → Run workflow**

Options:
- **Dry run**: Scans and classifies but sends NO Telegram alerts — good for testing
- **Send start notification**: Sends a "Scanner Starting" message to Telegram before the run begins

---

## What You'll Get on Telegram

### Per HIGH Priority Alert (immediately when found):
```
📈 TATAMOTORS — 🔴 HIGH PRIORITY
─────────────────────────
📋 What Happened
Tata Motors has secured an EV fleet order worth ₹2,400 Cr from a central
government ministry for supply over 3 years. This is the company's largest
single institutional order in the EV segment to date. Investors should watch
execution timelines and margin impact given the scale of the commitment.

📊 Key Figures
Order value: ₹2,400 Cr | Duration: 3 years | Implied annual run-rate: ₹800 Cr/yr

🔍 Why It Matters
Order backlog now approaching ~3.2x FY25 EV revenue — execution risk and
working capital requirements are the key variables to track.

🎯 AI Confidence: ✅ HIGH | Source: BSE
📅 Next Results: 2026-05-15

📄 View BSE Filing →

─────────────────────────
"Award of Work Order for Supply of Electric Vehicles"
🕐 11:02 AM IST
```

### End-of-Run Summary (when new filings are found):
```
📊 Scan Summary
─────────────────────────
🏢 Stocks scanned: 47
📋 New filings found: 3
📣 Alerts sent: 1
⏱️ Duration: 84.3s
🟢 1 alert sent

View Workflow Run →
🕐 09:07 AM IST
```

> **Quiet runs** (no new announcements, no errors) send NO summary — your Telegram stays clean.

---

## Monitoring

- Every run appears under **Actions** tab in GitHub
- Failed runs automatically send a "🔴 Scanner FAILED" Telegram message with a link to logs
- Concurrency is set to cancel older runs if a new one starts (prevents duplicate alerts)

---

## Local Testing (unchanged)

Your local run still works exactly as before:

```bash
node --env-file=.env.local backend/scripts/scan-announcements.js
```

To test the Actions wrapper locally:
```bash
# Set env vars manually, then:
node backend/scripts/scan-announcements-action.js
```
