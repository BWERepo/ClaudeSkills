# BWESEO Engine — Project Status

## Purpose
The canonical, reusable, versioned SEO engine behind the `/BWESEO…` Claude Code skills (state machine, validators,
Google / Search Console workflow, installer, skills). This repo is the **engine source, not a website**: no staging or
production deploy, and customer projects never write back here. Customer data lives only in each customer's own
`seo/` and `docs/seo/`.

- Repo: https://github.com/BWERepo/SEOEngine (branch `main`)
- Location: wherever this repository is checked out; tools find it through `BWESEO_ENGINE_HOME` (see `README.md` and `docs/CLOUD-SETUP.md`)
- Current engine version: **1.10.0** (`VERSION`, `package.json`, `engine-manifest.json` agree)
- Start of session: `/BWESEOBegin` · checkpoint: `/BWESEOCheckpoint` · wrap-up: `/BWESEOEnd` · both: `/BWESEOAll`

## How to run things
```
npm test                                   engine + installer + canonical tests (608 at 1.10.0)
node scripts/build-manual.mjs              regenerate BWESEO-SKILLS-AND-PROCEDURES.md (--check to verify)
node scripts/build-manifest.mjs            rebuild engine-manifest.json after ANY engine file change
node scripts/validate-canonical.mjs --run-tests
```
Docs to read first: `README.md`, `docs/ENGINE.md`, `docs/methodology/workflow-state.md`,
`docs/methodology/google-index-monitoring.md`.

## Skills (17 canonical sources in `skills/`)
BWESEO (front door), BWESEOAudit, Competitors, ContentPlan, CreatePage, Install, InternalLinks, Local, Opportunities,
Publish, QA, Refresh, Report, Schema, SearchConsole, Setup, Technical.
Engine maintenance skills (repository-owned, in `.claude/skills/`; load when Claude Code opens this repository, never
installed into customer projects): BWESEOBegin, BWESEOCheckpoint, BWESEOEnd, BWESEOAll. Delete any older user-level copies
of these four (see `docs/CLOUD-SETUP.md` §4). Not in this repository: the install shortcuts BWESEOInstallDryRun/Update/Verify.

Gotcha: `skills/*/SKILL.md` must use **LF** line endings and start with `---\nname:\ndescription:\n---` (a canonical
test checks it). Editing with tools that write CRLF on Windows breaks that test; convert with `sed -i 's/\r$//'`.

## Last updated: 2026-10-10

### Session 2026-10-10 — Local SEO / Google Business Profile module, Phase 1 (manual mode; version NOT bumped, still 1.10.0)
- New: `src/gbp-eligibility.mjs`, `gbp-discovery.mjs`, `gbp-profile.mjs`, `gbp-schema.mjs`, `gbp-state.mjs`, CLI `src/seo-local-gbp.mjs`, tests `src/gbp.test.mjs`
  (45 tests), `docs/methodology/google-business-profile.md`, `docs/GBP-IMPLEMENTATION-INVENTORY.md`; `/BWESEOLocal gbp` mode; operating-guide row.
- State is a new private file `seo/data/local-gbp/state.json` (+ `draft.json`): no schema bump, no migration. No network calls.
- Not built (needs Google API approval / OAuth credentials from the owner): OAuth, API-access detection, sync, authorized edits, reviews, posts,
  performance, competitor analysis, monitoring/alerts, dashboard section, improvement-queue integration (Phases 2-4). Version bump waits for the owner.
- Validation READY, 663/663 tests.

### Session 2026-10-10 (later) — GBP Phase 3 without Google approval (still 1.10.0)
- New `src/gbp-queue.mjs` (recommendations + workflow + sync into inventory `issues[]`, area local, no schema change), `gbp-reviews.mjs`, `gbp-posts.mjs`,
  `gbp-performance.mjs` (manual CSV/JSON import, 7/28/90-day windows), CLI commands `recommend`, `queue`, `reviews`, `review-request`, `posts`, `performance`;
  tests `src/gbp-ops.test.mjs`. Everything is manual-mode and owner-reported; nothing calls Google.

## Previous: 2026-10-03

### Session 2026-10-03 — Engine 1.10.0: Keyword Performance System (committed `9b63d60`, pushed; staging/production are per-site)
- New reusable capability: keyword → target page registry (`pages[].keywords` + `keywordDecisions[]` in each site's own
  `seo/content-inventory.json`), target-page/sitemap validation, indexing as CONFIRMED / INFERRED / UNKNOWN, Search Console query x page
  performance with previous-period trend, TARGET PAGE MISMATCH + cannibalization detection, discovered queries, priorities with reasons,
  caching/cooldown/daily ceiling, new-site handling. Not a SERP tracker. Doc: `docs/methodology/keyword-performance.md`.
- New files: `src/keyword-registry.mjs`, `keyword-target.mjs`, `keyword-performance.mjs`, `keyword-performance-run.mjs`, `seo-keywords.mjs`
  (+ `.d.mts`, 3 test files). `/BWESEO` reads `seo/data/keyword-performance/summary.json` (`state.keywords`, 8 new actions, dashboard block,
  `/BWESEO keyword <phrase>`). Validator, both schemas, template, the BWESEO / BWESEOSearchConsole / BWESEOInstall skills, manual and manifest updated.
- Fixed: `gsc-client.mjs` `isDate` regex was missing its backslashes; manifest build was broken by an unclassified `PROJECT_STATUS.md` (now DEV).
- User-level skills BWESEO / BWESEOInstall / BWESEOSearchConsole synced from the repo (the earlier drift follow-up is closed).
- Validation READY, 608/608 tests. The admin dashboard, endpoints, scheduled refresh and staging test are built in a
  customer site; nothing was deployed.

### Session 2026-10-02 (previous)

### Session 2026-10-02 — Engine 1.9.0: Google index monitoring
- Resumed with no PROJECT_STATUS.md (this file is its first version). Found 1.9.0 work uncommitted; validation READY,
  531/531 tests passing.
- 1.9.0 adds reusable Google index monitoring: `src/gsc-client.mjs` (Search Console API client),
  `src/index-monitor.mjs` (pure rules), `src/index-monitor-run.mjs` (storage + orchestration),
  `src/seo-google-index.mjs` (developer CLI: pull / status / investigate / explain), state integration in
  `seo-state-core.mjs` (`googleIndexOf`, new actions), config schema/template `analytics.searchConsole.indexMonitor`,
  and `docs/methodology/google-index-monitoring.md`.
- Integrated it into the **BWESEO master skill** (`skills/BWESEO/SKILL.md`): description, Step 1 item 4 "Google
  indexing" (reads `seo/data/google-index/snapshot.json`; independent of website health; API failure ≠ not indexed;
  only Search Console proves "indexed"; plain ratio, no score; stale snapshot refreshed), Step 2 display and details
  mode. Routing-table rows to `/BWESEOSearchConsole index pull|investigate|impressions` already existed.
- Checkpoint run: manual + manifest regenerated, validation READY, committed and pushed as `aea354b`.

## Known follow-ups
- **Next work (decided with the owner):** build the keyword dashboard, endpoints, scheduled refresh and staging test inside ONE customer
  site, using the 1.10.0 read model (`getKeywordPerformance`, `lookupKeyword`, `pageView`, `queryTable`). Then write that site's staging checklist.
  Do not deploy to production without the owner's explicit instruction. `seo-keywords.mjs refresh` is untested against real Google.
- Customer websites that already have the engine installed need `/BWESEOInstallUpdate` to receive 1.9.0 and 1.10.0.
- An earlier message mentioned a task called "BWE_SEO_1"; its meaning was never established (no matching file found).
