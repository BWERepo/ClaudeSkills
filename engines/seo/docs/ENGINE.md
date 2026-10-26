# BWESEO Engine — reusable SEO customer-acquisition methodology

Release 2026.10.26.02 (2026-10-26 — adds the `/BWESEOSearchWatch` skill (status, enable/disable, daily, weekly, and a `setup` walkthrough of the customer-site validation steps) and the Google search monitoring workflow (`seo-watch.mjs`, on by default after an install, with `enable` / `disable`): sitemap kept current from page events, a daily check of new pages plus a rotating sample, not-indexed / crawl-failure / unexpected-canonical flags feeding the improvement queue, and a weekly report with the three most useful fixes; unreleased). Release 2026.10.23.03 (2026-10-23 — contributor rule only: acceptance evidence required with each change; no engine code change; unreleased). Release 2026.10.23.02 (2026-10-23 — four small CLI fixes found by an acceptance run: doctor capability listing, outcomes review count, queue build summary, page-checks unreadable-file handling; unreleased). Release 2026.10.23.01 (2026-10-23 — adds the unified improvement queue (`seo-queue.mjs`), change-to-outcome history (`seo-outcomes.mjs`), the read-only diagnostics command (`seo-doctor.mjs`), the shared evidence contract, SEO regression detection (`seo-regression.mjs`), and review-signal handling in the landing quality gate; unreleased until the owner publishes it). Release 2026.10.20.03 (2026-10-20 — installer fix: a bundled copy of the engine may omit DEV files such as CLAUDE.md and the maintenance skills; manifest validation no longer reports them missing, and still checks their hash when present).
Release 2026.10.20.02 (2026-10-20 — adds the repository-local `/BWESEORelease` maintenance skill; no change to what websites receive). Release 2026.10.20.01 added the SEO Landing Page Generator (`/BWESEOLanding`, `seo-landing.mjs`).

Last release on the legacy numbering: **1.10.0** (2026-10-03 — Keyword Performance System, a reusable capability: a keyword → target page registry (`pages[].keywords` in each site's own content inventory: one primary + secondary keywords per page), target-page and sitemap validation, indexing shown as CONFIRMED / INFERRED / UNKNOWN with its source, the site's own Search Console data by keyword and page (7 days / 28 days / 3 months / custom, with the previous period for trend), wrong-page (TARGET PAGE MISMATCH) and cannibalization detection, discovered queries (ignore / monitor / add / investigate — never an automatic page), evidence-based priorities (FIX NOW … INSUFFICIENT DATA) with reasons, caching/cooldown/daily ceiling, new-site handling, `/BWESEO` state-awareness and `/BWESEO keyword <phrase>`, `seo-keywords.mjs`. Not a SERP tracker: nothing searches or scrapes Google. Schema: optional `pages[].keywords`, `keywordDecisions[]`, `analytics.searchConsole.keywordPerformance`. Also fixes `gsc-client.mjs` `isDate`, whose pattern was missing its backslashes. See `docs/methodology/keyword-performance.md`.)
Previous: 1.9.0 (2026-10-02 — Google Index Monitoring, a reusable capability: scheduled URL Inspection / Search Analytics / sitemap monitoring of PRODUCTION URLs only, an indexing lifecycle (published → sitemap → crawled → indexed → impressions kept as separate facts), per-URL history, milestones and an indexing timeline with typical timings, priority scheduling with quota/budget/throttle limits, alerts, a staging-stays-hidden check, a Worker-safe Search Console client shared with `seo-google.mjs`, `/BWESEO` state-awareness (Search Console / Sitemap / Indexing / indexing rate, diagnostic next actions) and `seo-google-index.mjs`. A Google API failure is "temporarily unavailable", never "not indexed"; website health and indexing health are independent. See `docs/methodology/google-index-monitoring.md`. No schema change; optional `analytics.searchConsole.indexMonitor` config.)
Previous: 1.8.0 (2026-09-30 — reusable page checks, `tools/seo-page-checks.mjs`, run by `post-publish-check.mjs` on staging and production and on their own against a saved page: `og:url` vs canonical (equivalent URLs are equal, genuinely different pages are a mismatch), declared vs real `og:image` dimensions (read only from the same site; a remote image is skipped, never failed), the H1 visible in the server HTML (no `opacity:0` until JavaScript), the shared navigation and footer on every public sub-page, and dead `#anchors` in the navigation/footer. New status **REVIEW REQUIRED** for uncertain findings. TanStack Start adapter: no page-specific `og:url` or image dimensions in the root layout, one shared metadata builder, shared header/footer, no hidden hero. No schema change.)
Previous: 1.7.2 (2026-09-30 — installer compares text files with line endings normalised, so a CRLF working copy is never a false "modified" (no recurring update conflicts); the engine locator has one order (`BWESEO_ENGINE_HOME`, alias `BWESEO_ENGINE`, the registered `engine-location.json`, then a flagged DEPRECATED legacy fallback), registration validates the manifest, `--verify` shows where the engine was found, `register-engine --check`; an adopted project with data is not told to run `/BWESEOSetup`; refactor records carry no personal paths. Previous, 1.7.1: canonical-engine hardening: the live probe never awaits releasing an unread response body (a stalled cancel could hang a health check); `/BWESEOInstall` recognises an existing installation and says so; `/BWESEO <page>` is documented in the skill; the master manual `BWESEO-SKILLS-AND-PROCEDURES.md` is generated from the actual skills and checked for drift; engine text is LF. Previous, 1.7.0: the Google workflow becomes explicit and automatable where Google's OFFICIAL APIs allow, and the
engine gains an installer. Google: separate page-level facts — readiness (`postPublication.google.readiness`), sitemap membership,
DISCOVERED / CRAWLED / INDEXED (each with its own date + source), performance (zero is valid) — and site-level facts (Search Console
property, sitemap registration, optional API, `credentialsSource` NAME only); `seo/tools/seo-google.mjs` (readiness mapping,
Search Console API client, idempotent sitemap registration, URL Inspection evidence, performance summary, Indexing-API guardrail);
manual Live URL test / Request Indexing are optional accelerators. Install: `/BWESEOInstall` — `manifest.json` allowlist (default DENY),
secret + project-identity scans, install / `--dry-run` / `--verify` / `--update`, installation receipt `seo/bweseo-install.json`,
`SCHEMA_VERSION` separate from `ENGINE_VERSION`.)
Previous: 1.6.0 (2026-09-30 — the live check never depends on a host fetching its own zone: `environments.health.strategy`
(`browser` default / `server` with a same-zone guard / `off`), `selfFetchRisk`, `sanitizeLiveCheck`, `buildProbeInput`, optional health
`endpoint`; a skipped check is `UNKNOWN`, never a failure).
Previous: 1.5.0 (2026-09-30 — ARCHITECTURE: lifecycle state and live site health are independent models.
LIFECYCLE STATE AND LIVE SITE HEALTH ARE INDEPENDENT. A failed availability check must never automatically reverse a completed SEO lifecycle milestone.
New: `state.liveHealth` (HEALTHY / DEGRADED / UNAVAILABLE / CHECK_FAILED / UNKNOWN + diagnostics, consecutive
failures, last success), `state.pages[].lifecycle` milestones, `production.reversal` for verified rollbacks,
`seo/data/live-health.json` + `--record-health`, the `investigate-health` action).
Previous: 1.4.1 (2026-09-30 — live-check health is separate from the lifecycle: a failed probe
(5xx / Cloudflare 522 / timeout / network) is `LIVE SITE CHECK: FAILED / UNAVAILABLE` and never changes a
page's recorded status or recommends `/BWESEOPublish`; 404/410 is a content conflict to investigate; one
retry + a circuit breaker; `classifyProbe`, `liveHealthOf`).
Previous: 1.4.0 (2026-09-30 — the Google half of the page lifecycle is explicit: Search Console
setup (site-level) → Live URL Test → Indexing requested → Sitemap verified (site-level) → Indexed by
Google (evidence only) → Monitoring; `analytics.searchConsole` site record, `postPublication.searchConsole.liveUrlTest`
and `.indexed`, `lifecycleGroups()` for the Admin card timeline).
Previous: 1.3.0 (2026-09-30 — environment-aware: LOCAL / STAGING / PREVIEW / PRODUCTION,
`methodology/environments.md`, config `environments`, the page `staging` record, staging review +
owner's staging approval before production, production-indexability and environment-leakage checks,
and the hard rule that staging is never submitted to search engines).
Previous: 1.2.0 (2026-09-29 — `/BWESEO` becomes the state-aware front door), 1.1.0 (2026-09-29 —
mandatory post-publication workflow), 1.0.0 (2026-09-29). Bump this line and `tools/validate-seo-data.mjs`'s
`ENGINE_VERSION` together whenever a schema or rule changes.

**Entry point: `/BWESEO`.** If you don't know what to do next, run it — it inspects the project's
real SEO state, says which environment it is describing, and recommends the one next step (and the
skill that does it). The other skills stay available for direct use.

```
LOCAL → STAGING → HUMAN REVIEW → PRODUCTION → GOOGLE
LOCAL = build it · STAGING = test it · PRODUCTION = customers and search engines see it
GOOGLE = request discovery / indexing and monitor the results
```

The engine answers one question for a business: **"What searches could bring this business a
qualified customer?"** — not "what topics could generate traffic?". It is a disciplined workflow,
not an article generator. It never mass-produces pages.

## Three layers

| Layer | What it holds | Where it lives |
|---|---|---|
| 1. Engine (this folder) | Methodology, scoring, checklists, industry guides, stack adapters, schemas, validator. **Business-agnostic. Never contains client data.** | `$BWESEO_ENGINE/` (mirrored to the backup repo by `/BWEBackupSkills`) |
| 2. Business profile | Verified facts about ONE business, each with provenance | `<project>/seo/business-profile.json` |
| 3. Website adapter | How THIS project's stack does metadata, routes, sitemap, schema, deploys | `<project>/seo/seo-config.json` + `adapters/<stack>.md` |

Strategy documents for a project live in `<project>/docs/seo/` (or the project's existing docs
location). Machine-readable data lives in `<project>/seo/`.

## Folder map

```
engine/
  README.md                  this file
  methodology/               one module per capability (read by the skills)
    discovery-onboarding.md  questionnaire-mapping.md  baseline-audit.md  technical-seo.md
    intent-model.md          opportunity-scoring.md    cannibalization.md competitor-research.md
    page-map-and-roadmap.md  content-standards.md      page-creation.md   internal-linking.md
    structured-data.md       local-seo.md              conversion.md      answer-engine-readiness.md
    qa-checklists.md         post-publication.md       search-console.md  measurement-reporting.md
    content-refresh.md       workflow-state.md         (how /BWESEO decides state + who records what)
    environments.md          (local / staging / preview / production — what each may do)
  industries/                industry adaptation guides (_template.md + one per industry)
  adapters/                  stack adapters (_template.md + one per stack)
  templates/                 starter JSON files + templates/docs/README.md (doc skeletons),
                             copied into a project by /BWESEOSetup
  schema/                    JSON Schemas for the three project data files
  tools/validate-seo-data.mjs  zero-dependency validator (vendored into each project's seo/tools/)
  tools/post-publish-check.mjs read-only live-page checker for /BWESEOPublish (vendored too)
  tools/seo-page-checks.mjs   reusable page checks (og:url vs canonical, social-image size, above-the-fold
                              visibility, shared navigation/footer); used by post-publish-check and runnable alone
                              on a saved page (vendored too)
  tools/seo-site-checks.mjs   read-only whole-site indexing-readiness checks on production (http/www consolidation,
                              robots.txt per host, sitemap sweep, redirect codes, blocked+noindex pages, key-page
                              links, image weight, demo hosts noindex); run by /BWESEOTechnical (vendored too)
  tools/seo-regression.mjs    SEO regression detection: compares a saved observation with the accepted baseline
                              (noindex, robots.txt, canonicals, errors, redirects, sitemap, broken links, orphans);
                              + regression-detect/-workflow (pure), -store, -collect (vendored too; see
                              docs/methodology/regression-detection.md)
  tools/seo-watch.mjs         Google search monitoring workflow: sitemap sync from page events, daily check (new pages +
                              rotating sample), not-indexed / crawl / canonical flags, weekly report; + search-watch
                              (pure rules); ON by default, `disable` switches it off (vendored too; see
                              docs/methodology/search-watch.md)
  tools/seo-state-core.mjs    the /BWESEO state machine: evidence → status dashboard → ONE next
                              action, plus the live checks. Imports nothing, so it also runs in a
                              Worker or browser (e.g. an admin status card). + .d.mts types
  tools/keyword-registry.mjs  keyword → target page registry, discovered-query decisions (pure; vendored too)
  tools/keyword-target.mjs    target-page and sitemap validation (pure; vendored too)
  tools/keyword-performance.mjs keyword/page analysis from Search Console rows (pure; vendored too)
  tools/keyword-performance-run.mjs fetch + cache + quota orchestration (Worker-safe; vendored too)
  tools/seo-keywords.mjs      developer CLI for the keyword system (vendored too)
  tools/seo-state.mjs         Node side: collects the evidence from disk and runs the CLI;
                              re-exports the core (read-only; vendored too; + .d.mts types)
  tools/isolation-allowlist.json  operator terms the engine may mention (the agency's own name)
```

## Skills (invoke by name)

| Skill | Purpose | Methodology it runs |
|---|---|---|
| `/BWESEO` | **The front door.** Reads the project's real state (`tools/seo-state.mjs`), shows a short dashboard, recommends ONE next action and routes to the skill below — never skipping an approval gate | workflow-state (+ all) |
| `/BWESEOSetup` | Configure a business/site: create `seo/` + `docs/seo/`, build the profile | discovery-onboarding, questionnaire-mapping |
| `/BWESEOAudit` | Full baseline audit → `SEO-BASELINE.md` | baseline-audit (+ technical, schema, local) |
| `/BWESEOTechnical` | Technical SEO audit only | technical-seo |
| `/BWESEOSchema` | Structured-data audit | structured-data |
| `/BWESEOLocal` | Local SEO analysis (only if location matters) | local-seo |
| `/BWESEOOpportunities` | Customer-intent opportunities, scored, cannibalization-checked | intent-model, opportunity-scoring, cannibalization |
| `/BWESEOCompetitors` | SERP/competitor gap analysis (needs web research) | competitor-research |
| `/BWESEOContentPlan` | Page map + prioritized roadmap + P1 report, then STOP | page-map-and-roadmap |
| `/BWESEOCreatePage` | Create ONE approved page | page-creation, content-standards, conversion, internal-linking, structured-data |
| `/BWESEOInternalLinks` | Internal-link analysis | internal-linking |
| `/BWESEOQA` | Validate a page before publication; `/BWESEOQA <id> staging` is the staging review | qa-checklists, environments |
| `/BWESEOPublish` | **Mandatory after a page goes live on production**: verify it's live, indexable, in the sitemap, linked, free of staging URLs; Search Console steps; 7/30/90-day monitoring; inventory update. On staging: a technical check with indexing actions disabled; local: not applicable | post-publication, environments |
| `/BWESEOSearchConsole` | Analyze Search Console exports; runs the 7/30/90-day page reviews; Google index monitoring; **keyword performance** (which page is meant to rank, indexed?, shown?, how is it doing) | search-console, google-index-monitoring, keyword-performance |
| `/BWESEORefresh` | Find pages that need updating | content-refresh |
| `/BWESEOReport` | Progress/performance report | measurement-reporting |

## The pipeline

```
BUSINESS PROFILE → SITE AUDIT → CUSTOMER INTENT → EXISTING CONTENT → OPPORTUNITIES
→ CANNIBALIZATION CHECK → COMPETITOR/GAP → PRIORITIZED ROADMAP → ** HUMAN APPROVAL (which page) **
→ CREATE ONE PAGE → INTERNAL LINKS → TECHNICAL SEO → CONVERSION CTA → SEO QA
→ DEPLOY TO STAGING → STAGING SEO / VISUAL REVIEW → ** HUMAN APPROVAL (on staging) **
→ ** THE OWNER'S GO ** → DEPLOY TO PRODUCTION THROUGH THE PROJECT'S OWN WORKFLOW
→ PRODUCTION POST-PUBLICATION CHECK → SEARCH ENGINE DISCOVERY / INDEXING → MONITOR (7/30/90 days)
→ MEASURE → IMPROVE
```

Skill chain for one page:
`/BWESEOCreatePage` → `/BWESEOQA` → staging deploy → `/BWESEOQA <id> staging` → owner's staging
approval → owner's go → production deploy → `/BWESEOPublish` →
`/BWESEOSearchConsole` (7/30/90-day reviews) → `/BWESEORefresh` → `/BWESEOReport`.

Lifecycle coverage: DISCOVER OPPORTUNITY (`/BWESEOOpportunities`) → PLAN (`/BWESEOContentPlan`) →
APPROVE (user) → CREATE (`/BWESEOCreatePage`) → QA (`/BWESEOQA`) → STAGING + STAGING REVIEW
(`/BWESEOQA <id> staging`) → APPROVE (user, on staging) → DEPLOY (project workflow, user's go) →
VERIFY PUBLICATION + HELP SEARCH ENGINES DISCOVER (`/BWESEOPublish`) → MONITOR +
MEASURE (`/BWESEOSearchConsole`, `/BWESEOReport`) → IMPROVE (`/BWESEORefresh`).

## Non-negotiable rules (every skill enforces these)

1. **Facts are not opportunities.** A keyword ("emergency AC repair <city>") never establishes
   that the business offers that service. Only a `verified` profile fact does. Missing → flag it
   as `needs-input`; never invent it.
2. **Never fabricate** customers, case studies, testimonials, ratings, reviews, awards,
   certifications, licenses, locations, employees, statistics, partnerships, history, prices or
   capabilities. Never add rating/review schema that isn't backed by real, on-page reviews.
3. **One page at a time**, only after the user approves that specific page. No mass generation,
   no doorway pages, no city-name or industry-name swapping.
4. **Improve before you create.** Every proposal passes the cannibalization check first.
5. **Customers over traffic.** Every commercial page needs a real conversion path defined by the
   profile's primary conversion.
6. **No deploys, pushes, paid tools or credentials** unless the user explicitly asks. Deploy only
   through the project's documented workflow (see `seo-config.json` → `workflows`). Never request
   indexing or change Search Console on the owner's behalf; never add indexing services.
7. **Reuse the project's architecture.** No new framework, CMS, router or dependency for SEO.
8. **No ranking guarantees.** "#1 on Google" / "rank in 24 hours" style claims are prohibited.
9. **A page isn't finished until `/BWESEOPublish` has verified it live on production** — never
   claim a page is indexable or ready for search engines while it exists only locally or on staging.
   Staging QA never replaces the production check.
10. **Staging is never submitted to search engines.** No Request Indexing, sitemap submission,
   IndexNow or Bing submission for a staging, preview, local or unknown URL — ever. Every skill run
   against one says **ENVIRONMENT: STAGING · SEARCH ENGINE INDEXING ACTIONS: DISABLED**. Environment
   URLs come only from each project's `seo-config.json` → `environments`, never from the engine
   (see `methodology/environments.md`).

## Client-data isolation

- The engine holds methodology only. `tools/validate-seo-data.mjs --engine <engine> --profile
  <project>/seo/business-profile.json` fails if the engine contains that client's phone, email
  or domain, or any email/phone-shaped string outside the allowlist.
- Every skill starts with the **project guard**: read `./seo/seo-config.json` in the current
  repo, confirm its `repo.gitRemote` matches `git remote get-url origin` (or, for a repo with no
  remote, that `repo.rootFolderName` matches the folder), and refuse to continue on a mismatch.
- A skill never opens another project's `seo/` or `docs/seo/` folder, and never copies profile
  data, pricing, competitors, analytics or content between projects.
- `seo/data/` (Search Console / analytics exports) is gitignored in every project.

## Installing into a new project

Run `/BWESEO` (or `/BWESEOSetup`) inside that project's repo. Setup copies `templates/*` and
`schema/*` into `seo/`, vendors `tools/validate-seo-data.mjs`, `tools/post-publish-check.mjs`, `tools/seo-page-checks.mjs` and
`tools/seo-state.mjs` + `tools/seo-state-core.mjs` (and their `.d.mts` types) (+ tests if the
project has a test runner), records the verified `environments` (production, staging — or "not
configured" — preview, local), fills the config's `publication` block (sitemap, robots, any existing
IndexNow/Bing mechanism) and Search Console settings, adds
`seo/data/` to `.gitignore`, picks the adapter, and starts the profile. Full manual:
the operations guide of the reference implementation (`docs/seo/SEO-OPERATIONS.md`).

## Installing and updating (1.7.0+)

**Do not copy engine files by hand.** Use `/BWESEOInstall`: it installs only the allowlisted, sanitized engine
files from this directory (see `manifest.json`), scans them for secrets and for any registered customer's identity,
never touches customer data, and records what it installed in `seo/bweseo-install.json`. `--dry-run` previews,
`--verify` reports, `--update` updates the engine only. This directory is the **canonical engine source**: located via
`$BWESEO_ENGINE_HOME` or `$BWESEO_ENGINE`, versioned by `manifest.json` (`engineVersion`,
`schemaVersion`, `manifestVersion` — never a website's version number), and never modified by an install.
Maintainers: after changing engine files run `node tools/bweseo-install.mjs --build-manifest --engine . --skills <list>`;
it refuses any file it has no classification rule for.

### History of what upgrades added

(Historical note for the pre-installer procedure of comparing `engine.version` with this README's version.)
Compare `seo/seo-config.json` → `engine.version` with this README's version. If older, use `/BWESEOInstall --update`
(previously: re-copy `schema/*` and every file in `tools/` except `isolation-allowlist.json`),
run the validator, and fix any new errors (1.1.0 adds the config `publication` block and inventory
publication fields; 1.2.0 adds the optional workflow fields — `name`, `roadmapOrder`, `blockedBy`,
`hold`, `qa.sourceHash`, `refresh`, history dates, `monitoring.completed` — and the top-level
`issues[]`; see `methodology/workflow-state.md`; 1.3.0 restructures config `environments` into
`production {url, hosts}` / `staging {status, url, hosts, indexProtection}` / `preview` / `local`,
moves `publication.stagingHosts` into `environments.staging.hosts`, and adds the optional page
`staging` record and the `environment` issue area; see `methodology/environments.md`). Back-filling those fields is optional: the state
tool works without them, just with less precision. Never overwrite the project's own profile,
inventory or docs during an upgrade.
