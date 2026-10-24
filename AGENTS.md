# ThesisIQ agent rules

The complete, authoritative rules live in [`.agents/AGENTS.md`](.agents/AGENTS.md) — read it fully before changing
anything under `backend/`. Part 2 (sections 8–15) covers the alert pipeline: mandatory checks
(`npm run lint:backend`, `npm run test:heart`, `npm test`), the 16 hard invariants, a debugging playbook for
"I did not get an alert", and the thesis-data rules.
