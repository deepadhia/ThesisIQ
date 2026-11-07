# ThesisIQ runbook (operations, not development)

## What you receive, and why
| You get | When | Means |
|---|---|---|
| A stock message starting `⚖️ ALLOCATION:` | when it happens | something changed the view: stance, conviction, hurdle, a driver got worse, guidance changed, a downside surprise, results that could not be verified |
| Direct alerts (credit, governance, regulatory, capital raise, restructuring; an order / capex / acquisition that is >= 3% of market cap or negative) | when it happens | structural or material event |
| `📋 ALLOCATION BOARD` | once a day, from 18:00 IST | every other filing of the day, one line per stock, with its stance. Nothing on it needs action |
| `🩺 SYSTEM CHECK` | once a day from 19:00 IST, ONLY when something is wrong | the system found a silent failure itself (see below) |
| `📅 EARNINGS CALENDAR` | mornings, only when a stock reports | what reports today / tomorrow / in 3 days |

No SYSTEM CHECK message means the self-audit found nothing wrong.

## After every deploy (2 minutes)
1. On the server: `node --env-file=.env.local backend/scripts/smoke-check.js`. Every line must be `ok` (a `WARN` is allowed). It checks Node, the database, Telegram, the Groq and Gemini keys, ffmpeg, the canvas binary (page-level OCR), source corruption, the gate and the model registry.
2. `bash scripts/update-oracle-daemon.sh` picks the right cron for the server clock (UTC server: `*/5 2-18 * * *`).
3. Watch the first scan: `[ALLOCATION GATE]`, `[WORKER BOARD]`, `[OVERRIDE] results outcome queued`, `[PDF OCR] Statement page(s)` lines are the new behaviour working.

## When a SYSTEM CHECK arrives
| Line | What it means | What to do |
|---|---|---|
| results filed but never read | a results filing was classified as something else and skipped (the MOREPENLAB / LUMAXTECH / QPOWER failure) | `node --env-file=.env.local backend/scripts/requeue-stuck-filings.js --only --ids <id>` (dry run), then `--apply` after deploy |
| results ... but no verified numbers | the statement could not be parsed or OCR-read (the POLICYBZR failure) | open the filing; re-queue once the cause is fixed; add a real-page fixture and test |
| filings waiting more than 6 h | the worker is not finishing them (AI quota, provider down, crash) | read `pipeline_error` on the row; `pm2 logs multibagger-scanner` |
| alerts could not be delivered | Telegram outage or a wrong chat id; they retry every cycle | check the bot token / chat id |
| filings waited over 30 h for the board | the worker did not run after 18:00 IST | check PM2 and the cron window |
| graded two different ways | same stock, two stances within 48 h on verified numbers | a real inconsistency: open both rows (`institutional_verdict`) |
| gate switched OFF | `ALLOCATION_GATE=off` is set | remove it to go back to quiet mode |
| source file contains a control character | an editing accident corrupted a regex (it silently stops working) | restore the line; the hygiene test fails on it too |

## Switches
* `ALLOCATION_GATE=off` — every alert is pushed again (no board). Set in the server environment; no deploy needed.
* Re-queue a filing: `requeue-stuck-filings.js --only --ids <uuid>` (dry run by default; `--apply` backs up first). Never edit rows by hand (AGENTS.md rule 1).

## Rules of thumb
* A message you did not expect is a bug in a threshold (tune it in `allocation-relevance.service.js`) or in a parser (add the real page as a fixture first).
* A message you EXPECTED and did not get: look at the board, then the SYSTEM CHECK, then AGENTS.md section 11.
