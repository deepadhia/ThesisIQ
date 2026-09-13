# Project Agent Rules & System Constraints

## 1. Zero Manual Database Patching Rule
- **NEVER** run ad-hoc SQL `UPDATE` or `DELETE` scripts to manually override database rows or force status changes.
- If data or status is incorrect in the database, you **MUST** diagnose and fix the underlying code, LLM prompt, or parser logic so the system automatically computes and extracts the correct state dynamically.

## 2. Multi-Stage Regulatory Commitment Evaluation Rule
- For multi-stage corporate actions (e.g., Schemes of Arrangement, Demergers, M&A, QIP allotments, NCLT filings, SEBI approvals):
  - Initial Board Approval **MUST NOT** be marked as `Achieved` for final completion.
  - Initial Board Approval must be extracted with `status = "Pending"` (In Progress).
  - A commitment can **ONLY** be evaluated as `Achieved` when final regulatory clearance (e.g., final NCLT court order, SEBI in-principle approval, or exchange listing intimation) is officially published.

## 3. Dynamic Business Logic Rule
- **NEVER** add static hardcoded ticker branches (e.g., `else if (ticker === "ANANTRAJ")`) or static metric figures in backend worker code.
- All guidance reconciliations, commitment extractions, and credibility scores must be computed dynamically using generic LLM prompts and database schema relations.

## 4. Zero Automatic Git Commits or Pushes Rule
- **NEVER** execute `git commit` or `git push` automatically without getting explicit user confirmation and approval first.
- Always show the exact proposed commit message and changed files to the user, and wait for explicit permission before attempting to commit or push to GitHub.

## 5. Automated Execution & Confirmation Boundary
- **NEVER** execute ad-hoc inline terminal scripts (`node -e "..."`) which defeat IDE security whitelists and trigger repeated permission modals.
- Non-destructive commands (read-only queries, invariant test runners, linting, build verification) must run automatically without interrupting the user.
- The agent **MUST ONLY** ask for user confirmation before destructive or state-mutating actions:
  - Database `UPDATE` / `DELETE` / `DROP` queries
  - File deletions or destructive migrations
  - Git commits and pushes

