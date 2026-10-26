# BWESEO Engine — Project Status

## Purpose
The canonical, reusable, versioned SEO engine behind the `/BWESEO…` Claude Code skills (state machine, validators,
Google / Search Console workflow, installer, skills). This repo is the **engine source, not a website**: no staging or
production deploy, and customer projects never write back here. Customer data lives only in each customer's own
`seo/` and `docs/seo/`.

- Repo: https://github.com/BWERepo/SEOEngine (branch `main`)
- Location: wherever this repository is checked out; tools find it through `BWESEO_ENGINE_HOME` (see `README.md` and `docs/CLOUD-SETUP.md`)
- Current engine version: **2026.10.26.02** (`VERSION`, `package.json`, `engine-manifest.json` and `ENGINE_VERSION` in `src/validate-seo-data.mjs` agree; `node scripts/build-manual.mjs --check` fails if this line drifts from `VERSION`). Versions before 2026.10.20.01 used the legacy numbering (last: 1.10.0).
- Released versions are recorded below only where the owner named them; changes after 2026.10.26.02 that are not yet released are listed under "Unreleased" in the latest session record. Nothing in this file is evidence that a customer website has been updated or deployed.
- Start of session: `/BWESEOBegin` · checkpoint: `/BWESEOCheckpoint` · wrap-up: `/BWESEOEnd` · both: `/BWESEOAll`

## How to run things
```
npm ci                                     install the test tooling from the lockfile (development only; needs Node 20.19+ or 22.12+)
npm test                                   engine + installer + canonical tests (run it for the current count; counts in old session records are historical)
node scripts/build-manual.mjs              regenerate BWESEO-SKILLS-AND-PROCEDURES.md (--check to verify)
node scripts/build-manifest.mjs            rebuild engine-manifest.json after ANY engine file change (--check to verify only)
npm run check:generated                    verify the manual, the operating guide and the manifest are current (what pull-request checks run)
node scripts/validate-canonical.mjs --run-tests
```
Docs to read first: `README.md`, `docs/ENGINE.md`, `docs/methodology/workflow-state.md`,
`docs/methodology/google-index-monitoring.md`.

## Skills (20 canonical sources in `skills/`)
BWESEO (front door), BWESEOAudit, Competitors, ContentPlan, CreatePage, Install, InternalLinks, Landing, Local, Opportunities,
Publish, QA, Refresh, Report, Schema, SearchConsole, SearchWatch, Setup, Technical, Update.
Engine maintenance skills (repository-owned, in `.claude/skills/`; load when Claude Code opens this repository, never
installed into customer projects): BWESEOBegin, BWESEOCheckpoint, BWESEOEnd, BWESEOAll, BWESEORelease. Delete any older user-level copies
of these (see `docs/CLOUD-SETUP.md` §4). Not in this repository: the install shortcuts BWESEOInstallDryRun/Update/Verify.

Gotcha: `skills/*/SKILL.md` must use **LF** line endings and start with `---\nname:\ndescription:\n---` (a canonical
test checks it). Editing with tools that write CRLF on Windows breaks that test; convert with `sed -i 's/\r$//'`.

## Last updated: 2026-10-26 (engine 2026.10.26.02)

### Session 2026-10-26 (second) — `/BWESEOSearchWatch` skill (bumped to 2026.10.26.02; not released or deployed)
- New canonical skill `skills/BWESEOSearchWatch/SKILL.md`: status, enable/disable, daily, weekly, and a `setup` walkthrough that consolidates the customer-site validation steps (install check, seed, publish hook, sitemap served, Search Console access, first daily run, rotation, schedule, weekly report) into one-step-at-a-time checks with a pass/fail table. Reference entry in `docs/skills-reference.json`; manual regenerated.
- Not done / not verified: the skill itself was not run against a live site; the steps remain customer-site work.

### Session 2026-10-26 — Google search monitoring workflow (bumped to 2026.10.26.02; not released or deployed)
- New `src/search-watch.mjs` (pure rules) and CLI `src/seo-watch.mjs` (`status`, `enable`, `disable`, `notify`, `seed`, `sync`, `daily`, `weekly`, `findings`); data in `seo/data/search-watch/`; docs in `docs/methodology/search-watch.md` and the operating guide. Reuses fetchChain, extractHead, the Search Console client, index-monitor state rules, outcome-history period rules, safe-write and the improvement queue (new `search-watch` source, `fromSearchWatch`). `outcome-history.mjs` now also exports `summarize`, `positionOf`, `rel` (no behavior change).
- ON by default after an install (config block optional; `enabled: false` switches it off); the installer reports the state and edits nothing. Config schema, template, validator and doctor know the `searchWatch` block.
- Not done / not verified: nothing was run against a live site or Google (fake fetch and fake Search Console client only); the website's publish hook that calls `notify` and the scheduler that runs `sync`, `daily` and `weekly` are customer-site work; `/BWESEO` state machine does not yet surface search-watch status.

### Session 2026-10-23 (fourth) — acceptance-evidence contributor rule (bumped to 2026.10.23.03; not released or deployed)
- `CLAUDE.md` rule 9 and the operating guide's "Make a change" step 7 now require an acceptance table, a disposable-project demonstration with failure and recovery cases, separated evidence types, and customer-site validation steps. No code changed.

### Session 2026-10-23 (third) — retroactive acceptance run and four small defect fixes (bumped to 2026.10.23.03; not released or deployed)
- Ran the full suite, canonical/manifest/installer/isolation checks, and drove the real CLIs (installer, doctor, regression, queue, outcomes, page checks, city pages) in a throw-away project with fixtures only. No live service was contacted.
- Defects found by that run and fixed (each with a test): `seo-doctor` listed keyword performance as enabled whenever the config object existed, even with `enabled: false`; `seo-outcomes list` counted a repeated review of the same date twice (`reviews 2/3`); `seo-queue build` reported "0 resolved" when an item was resolved at its source; `seo-page-checks` printed a stack trace (exit 1) for an unreadable `--html`/`--home` file, now a one-line message and exit 3.
- Not verified: anything against a live site or Google; see the acceptance report delivered in the project thread for the customer-site steps.

### Session 2026-10-23 (second) — improvement queue, outcome history, diagnostics, content-quality review signals (bumped to 2026.10.23.03 on the owner's standing instruction to update the version on each change; not released or deployed)
- New `src/evidence.mjs`: shared evidence/freshness contract (source, observedAt, coverage, freshness, label-only confidence, unavailable reason; metrics are a value or an unavailable reason, never a silent 0).
- New `src/improvement-queue.mjs`, `improvement-sources.mjs`, CLI `seo-queue.mjs` (`build`, `list`, `next`, `explain`, `decide`, `assign`), data in `seo/data/improvement-queue.json` (`queueSchemaVersion: 1`, schema-0 upgrade, newer refused). Reads inventory issues, GBP recommendations, stored keyword data, landing state and a saved regression report; deduplicates, preserves human decisions, resolves only on a complete covering run. `seo-state.mjs` passes the queue's next item to the state machine as a `queue-next` action ranked 650 (after blockers, setup, approvals and inventory issues). See `docs/methodology/improvement-queue.md`.
- New `src/outcome-history.mjs`, CLI `seo-outcomes.mjs` (`record`, `list`, `due`, `compare`, `review`), data in `seo/data/outcomes.json` (`outcomesSchemaVersion: 1`). See `docs/methodology/change-outcomes.md`.
- New read-only CLI `seo-doctor.mjs` (PASS/WARN/FAIL/UNKNOWN; credentials by name only; scheduler success is recorded evidence only).
- `landing-quality.mjs`: word-count and phrase-density checks are now `review` signals (non-blocking), configurable via `landing.qualityThresholds`; missing alt (error) is distinct from empty alt (decorative); empty body, claims, prices, duplicates and approval rules still block. See `docs/methodology/landing-pages.md`.
- Regression detection is a separate module (`seo-regression.mjs`, merged from PR #30); the queue consumes a saved report through `fromRegressionReport`. See the verification note in the merge session record.
- Not done / not verified: nothing released, deployed or run against live services; the queue's keyword source needs stored Search Console data; landing city pages are not yet a queue source; queue/outcomes data lives in gitignored `seo/data`.

### Session 2026-10-23 — SEO regression detection (UNRELEASED; included in 2026.10.23.03)
- New self-contained module: `src/regression-detect.mjs` (pure comparison, severity rules, findings contract), `regression-workflow.mjs` (intentional-change records,
  findings lifecycle, baseline rules, read model; pure), `regression-store.mjs`, `regression-collect.mjs` (glue over `fetchChain` / `extractHead` / `extractLinks` /
  `parseSitemap`, injected fetch), CLI `src/seo-regression.mjs`; docs in `docs/methodology/regression-detection.md` and the operating guide. Data: `seo/data/regression/`.
- Not done / not verified: nothing was run against a real site (tests use fixtures and a fake fetch); `/BWESEOTechnical` does not call it yet; the unified issue queue
  of the parallel thread consumes `issues` / the findings contract but is not wired; the sitemap-entry findings supersede the page-level ones for sitemap URLs by design.

### Session 2026-10-23 — review fixes (UNRELEASED; included in 2026.10.23.03)
Verified against the 2026.10.20.03 code first; every finding reproduced.
- Landing: `planOpportunities` merges only groups with the same service/topic identity (not just the same intent); approvals now bind to the
  full publish payload (`path`, canonical, structured data, links, images, indexability, title, description, H1, body, headings, FAQ, CTA)
  with a versioned hash, and a pre-existing unversioned approval is treated as legacy and must be re-approved; `plan` reconciles by stable
  identity (keeps drafts/checks/approvals, voids them when the target or primary phrase changes, parks unmatched work under `retired`).
- Keywords: `refreshTargets` checks at most 25 targets per run but rotates (never-checked first, then least recently attempted), keeps
  earlier results, reports coverage; keyword refresh and target validation take run locks; the index monitor lock is owner-checked.
- Concurrency contract (see `docs/methodology/google-index-monitoring.md`): single-flight only on stores with an atomic `acquire`
  (`memoryStore`, or a host store backed by a Durable Object / database row). Plain KV is best-effort and reports `lock.atomic: false`.
- Local CLIs write JSON via temp file + rename (`src/safe-write.mjs`); the landing and keyword CLIs serialize with a file lock; a corrupt
  state file is an error, never silently replaced.
- `gsc-client.mjs`: the token exchange has the same time bound as API calls (also when a fetch ignores its signal); no retries are added;
  concurrent token exchanges are shared.
- New pull-request workflow `.github/workflows/pr-validation.yml` (verify-only checks); `build-manifest.mjs --check`; package.json `engines`
  now states the development runtime (Node 20.19+/22.12+), consumer runtime stays Node 18+.
- Docs: this file's current-status lines corrected; `build-manual.mjs --check` now validates them against `VERSION` and `skills/`.
- Not done / not verified: the new workflow has not run on GitHub yet; nothing was released, deployed or tested against real Google.

### Session 2026-10-20 — SEO Landing Page Generator (released as 2026.10.20.01 as approved)
- New: `src/landing-keywords.mjs` (CSV intake, intent grouping, unavailable-metrics model), `landing-opportunities.mjs` (new-vs-improve decision,
  evidence-only ranking, URL/title proposals), `landing-quality.mjs` (quality gate + approval hash workflow), CLI `src/seo-landing.mjs`,
  skill `/BWESEOLanding`, `templates/landing-dashboard.html`, `docs/methodology/landing-pages.md`, tests `landing-*.test.mjs`.
- Lesson: the live site already had /pricing, /website-redesign (with a cost section) and a Knoxville page, so pricing/redesign-cost keywords
  are "improve existing", not new pages. Customer-specific proposals live outside this repo (customer-neutral rule).
- Not built: Search Console wiring of `performance` into landing state, before/after diff view, live SERP research (needs search access).
- Validation READY, 716/716 tests.
- Later the same day: added the repo-local `/BWESEORelease` skill (PR #21) and released 2026.10.20.02; 2026.10.20.03 fixes manifest validation of bundled copies that omit DEV files (the ClaudeSkills plugin copy failed an update with six missing files); ClaudeSkills plugin PR #12 bundled 2026.10.20.01.

## Previous sessions (historical records — counts and "not built" lists describe the day they were written, not the current state)

## 2026-10-10

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
Current (2026-10-23): decide the next version number and release the unreleased review fixes (owner decision); after release, customer websites
with the engine installed need `/BWESEOUpdate` (or the installer's `--update`) to receive them; confirm the new pull-request workflow is green on GitHub;
the live Search Console behaviour of `seo-keywords.mjs refresh` and of the token timeout is still untested against real Google.

Carried from earlier sessions (not re-confirmed since they were written):
- **Next work (decided with the owner, 2026-10-03):** build the keyword dashboard, endpoints, scheduled refresh and staging test inside ONE customer
  site, using the 1.10.0 read model (`getKeywordPerformance`, `lookupKeyword`, `pageView`, `queryTable`). Then write that site's staging checklist.
  Do not deploy to production without the owner's explicit instruction. `seo-keywords.mjs refresh` is untested against real Google.
- Customer websites installed before 2026.10.20.01 predate the Landing Page Generator and 1.9.0/1.10.0 may be missing too; each site's installed version is in its own `seo/bweseo-install.json`.
- An earlier message mentioned a task called "BWE_SEO_1"; its meaning was never established (no matching file found).
