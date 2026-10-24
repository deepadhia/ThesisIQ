# ThesisIQ — instructions for Gemini (and any other coding agent)

@.agents/AGENTS.md

## If you read nothing else, obey these 8 lines
1. The product's heart is: every result / investor presentation / concall → ONE correct, thesis-judged Telegram alert. A silent miss is the worst bug.
2. After ANY change to the alert pipeline run `npm run lint:backend`, `npm run test:heart`, `npm test` and show the real output. Passing unit tests of other modules prove nothing.
3. Send the Telegram alert BEFORE marking a filing `completed` and before any slow work (the daemon is killed every 5 minutes). A failed send is parked and retried, never dropped.
4. Never fabricate a verdict or a number. LLM failed → retry, then honest degraded alert. Numbers come only from the deterministic parser (or the text-grounded fallback, labelled UNVERIFIED).
5. A bearish analysis, a broken thesis driver, or unverified figures can only downgrade a buy — never the reverse.
6. Exchange timestamps are IST (use `parseExchangeTimestamp`); BSE PDFs are `ATTACHMENTNAME` not `NEWSID`; BSE API needs a date window.
7. No manual SQL patches, no per-ticker `if` branches, no `node -e`, no commits/pushes without explicit user approval.
8. Read the whole function before editing; write the failing test first; report exactly what you ran and what you did not verify.
