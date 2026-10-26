# Unified improvement queue and the evidence contract

The queue gathers work found by different modules into one prioritized list in the customer's own data (`seo/data/improvement-queue.json`).
It does not replace any module's workflow store: inventory `issues`, the Google Business Profile recommendations, the landing state and a saved
regression report stay where they are and are only read. Code: `src/improvement-queue.mjs` (rules), `src/improvement-sources.mjs` (adapters),
`src/seo-queue.mjs` (CLI), `src/evidence.mjs` (evidence contract).

## Evidence and freshness contract (`evidence.mjs`)
Every observation is `{ source, observedAt, coverage, freshness, ageDays, confidence, basis, unavailable, detail }`.
- `coverage`: complete, partial, none or unknown. A failed check is `none`.
- `freshness`: fresh or stale against a maximum age (default 14 days), or unknown when there is no date. Stored evidence is re-graded against the current date whenever it is read.
- `confidence` is a label, never a number: **high** = complete, fresh and directly observed; **medium** = complete and fresh but reported or derived, or partial but fresh and observed; **low** = stale, or partial and not observed; **unknown** = unavailable, no coverage or no date.
- Metrics are `{ available: true, value }` or `{ available: false, reason }`. A real zero is a value; a missing figure is never 0.
- Effort and impact stay `unknown` unless the source module supplies them. The engine does not estimate them.

## Item contract
Stable `id` (category plus a hash of module, check and the finding's reference), customer-local scope (the site), target, category, source, evidence, first and last observed dates, missing information, recommended action and reason, severity, effort, dependencies, owner, status, history and verification criteria.
Statuses: `open`, `approved`, `in-progress`, `fixed`, `resolved`, `deferred`, `wont-fix`.

## Rules
- **Deduplication.** The same finding found again updates the existing item (evidence, last observed); it is never added twice, within a run or across runs.
- **Human decisions.** `approved`, `in-progress`, `fixed`, `deferred` and `wont-fix`, owners and added dependencies are kept when a later run sees the finding again. Every decision is in the item's history with the person's name.
- **Resolved versus disappeared.** An item becomes `resolved` only when a *complete* run of the check that found it covers its target and no longer reports it. A partial or failed run changes no status; it records `unconfirmed` in the history and a "did not confirm" note. Sources that keep their own workflow (inventory issues, GBP, landing) are mirrored: their absence proves nothing, and their statuses win.
- **Reappearance.** A resolved item reported again is reopened with a history entry; a `fixed` item reported again by a complete check goes back to `open`.
- **Priority** is a fixed ordering, not a score: (1) site-wide blocker, (2) severity, (3) impact reported by the source, (4) fresher evidence, (5) smaller known effort (unknown effort ranks last), (6) older first observation, (7) id. `explain <id>` lists the factors.
- **Next action** (`next`): the first item in that order that is eligible. Not eligible: resolved, deferred or wont-fix items; items whose dependencies are unresolved; keyword, landing-page and content items while a site-wide blocker is open. Eligible items get one action: `approve` (needs a person), `work`, `verify` (a fix is recorded), or `recheck` (evidence older than the maximum age, or the last check did not complete). Skipped higher-ranked items are listed with the reason.
- The main state machine (`seo-state.mjs`) adds the queue's next item as one action ranked after every lifecycle prerequisite, blocker and inventory issue; it never outranks them.

## Regression findings
Detection is done by the regression module (`seo-regression.mjs`). `build` reads its findings store (`seo/data/regression/findings.json`) directly and mirrors each finding's status (open, intentional, resolved, accepted) and human decisions; that module's own check decides recovery, so absence from the store never resolves anything here. For any other detector the queue also accepts a saved report: `{ run: { status, observedAt, coveredUrls? }, findings: [{ type, severity, url, firstObserved, lastObserved, previous, current, impact, action, verification[], limitations[], siteWide? }] }` (`seo-queue.mjs build --regression report.json`, or `seo/data/regression/report.json`). A finding in a partial or failed run is carried but never resolves anything.

## Schema
`queueSchemaVersion: 1`. A file with no version is read as schema 0 and upgraded in memory (nothing invented; unknown fields become explicit unknowns); a file from a newer engine is refused and left untouched.
