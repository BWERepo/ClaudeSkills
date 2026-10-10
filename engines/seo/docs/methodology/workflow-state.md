# Workflow state — how /BWESEO knows where a project is

`/BWESEO` is the front door to the engine. Every run inspects the project, works out where the
project and each page are in the lifecycle, and recommends **one** next action. The logic lives
in `tools/seo-state-core.mjs` (pure; imports nothing, so a website's own admin can run it too) and
`tools/seo-state.mjs` (collects the evidence from disk; the CLI), both vendored into each project's
`seo/tools/`. This module is the rulebook they implement and that every other skill follows when
it records progress.

## The lifecycle (cyclical)

```
SETUP → AUDIT → FIND OPPORTUNITIES → PLAN → HUMAN APPROVAL → CREATE ONE PAGE → SEO QA
→ DEPLOY TO STAGING → STAGING SEO / VISUAL REVIEW → HUMAN APPROVAL → DEPLOY TO PRODUCTION
→ PRODUCTION POST-PUBLICATION CHECK → SEARCH ENGINE DISCOVERY / INDEXING
→ MONITOR (7/30/90 days) → MEASURE → IMPROVE → REPEAT
```

Short form for owners: **SETUP → FIND → PLAN → BUILD → CHECK → TEST ON STAGING → PUBLISH → WATCH →
IMPROVE → REPEAT.** LOCAL = build it · STAGING = test it · PRODUCTION = customers and search engines
see it · GOOGLE = request discovery and measure.

Staging is the normal safety gate wherever the project has one. A project without staging
(`environments.staging.status: "not-configured"`) goes from SEO QA to the owner's production
approval. The environment rules — including **staging is never submitted to search engines** — are
in `environments.md`.

Setup, audit, opportunities and the roadmap are project-level. Everything from approval onwards
happens **per page** — several pages can be at different stages at once.

## Step statuses

| Status | Meaning |
|---|---|
| COMPLETE | Done, with evidence |
| IN PROGRESS | Started, not finished (e.g. a `draft` page) |
| READY | Nothing stands in the way; Claude can do it now |
| NOT STARTED | Could start, hasn't |
| BLOCKED | Waiting on a fact only the owner can give, or a failed check |
| NEEDS HUMAN APPROVAL | A gate: the owner decides (which page, whether to deploy, whether to change a live page) |
| NEEDS MANUAL ACTION | Only the owner can do it (Search Console, exports) |
| WAITING FOR DATA | Nothing to do until the next review date |
| ON HOLD | The owner paused this page |
| WAITING | An earlier step isn't finished yet |
| UNKNOWN ("not recorded") | No record and nothing to infer it from — never guessed |

## Evidence beats status fields

The state is worked out from evidence, not from one field:

| Evidence | What it proves |
|---|---|
| `seo/seo-config.json`, `business-profile.json`, `content-inventory.json` exist and validate | Setup done |
| `openQuestions` with `blocking: true` (unanswered) | The profile blocks progress |
| `docs/seo/SEO-BASELINE.md` with real content + its "Last updated" date | Audit done (stale after 180 days) |
| Inventory entries with a priority or an idea/planned/approved/… status | Opportunities scored |
| `docs/seo/CONTENT-ROADMAP.md` with real content | Roadmap done |
| `status`, `approvedOn` + `approvedBy: "user"` | Approval (only the owner approves) |
| `status: review` **and** the source files named in `source` exist | Page created |
| `qa.result` + `qa.date` + `qa.sourceHash` | QA passed/failed — and for which version |
| A read-only GET of the staging URL containing `verifyText` (else `staging.deployedOn`) | On staging |
| `staging.review` (+ `sourceHash`) | Staging review passed/failed — and for which version |
| `staging.approval` (owner's words only) | The owner approved the page on staging |
| A read-only GET of the production URL containing `verifyText` | Deployed to production |
| Production home page + robots.txt (live) | Production indexable (no noindex, not blocked) |
| Staging home page + robots.txt (live) | Staging hidden from search engines (strong / weak / none) |
| `postPublication` (written by `/BWESEOPublish`) | Post-publication check |
| `postPublication.searchConsole.indexingRequest` / `requestSource` | Indexing request (owner-confirmed only) |
| `postPublication.monitoring` review dates + `.completed` | Monitoring schedule and which reviews ran |
| Files in `seo/data/search-console/<date>/` | Search Console data available for a review |
| `refresh.trigger` + `refresh.evidence` | A page really needs improving |
| `issues[]` in the inventory | Site-wide audit findings still open |

### Stale-state rules

- **Published but not live**: the inventory says live, production returns 4xx or redirects
  elsewhere → report the conflict first. If the page answers on staging only: **PUBLISHED STATUS
  CONFLICT — PRODUCTION NOT VERIFIED** (staging never counts as published).
- **Production not indexable** (noindex or a robots.txt block on production) → **CRITICAL SEO
  ERROR**, before any page work.
- **Live on production before the staging review / approval** (when staging exists) → reported,
  then the post-publication check.
- **Live before QA**: a `review` page is found on production (its `verifyText` is there) but QA
  never passed → QA it now, then the post-publication check.
- **QA is stale** when the page's current source hash differs from `qa.sourceHash`. Without a
  recorded hash, when a source file's modification date is later than `qa.date`. The same rule
  applies to `staging.review` and `staging.approval`: an edit sends the page back through them.
- **Built but missing**: a `review` page whose source files can't be found.
- **Stale blocker**: a `blockedBy` id that is no longer an open question counts as resolved (and
  is reported so the record can be cleaned up).
- **Audit / profile / published page** not reviewed for 180 days → due for a re-check (low priority).

## Where state lives (no extra status files)

Everything persists in the files the engine already uses, so a new Claude Code session picks up
exactly where the last one stopped.

| Field (inventory page entry unless noted) | Written by | When |
|---|---|---|
| `status`, `priority`, `roadmapOrder`, `name`, `proposedOn`, `blockedBy` | `/BWESEOOpportunities`, `/BWESEOContentPlan` | Planning |
| `approvedOn`, `approvedBy: "user"`, `status: approved` | The skill that asked, after the owner said yes | Approval |
| `created`, `lastModifiedOn`, `status: review`, `verifyText`, `linksFrom`, `claims` | `/BWESEOCreatePage` | Build |
| `qa: { result, date, sourceHash, report }` | `/BWESEOQA` (`sourceHash` from `node seo/tools/seo-state.mjs --hash <id>`) | QA |
| `staging.deployedOn` | The skill that deployed to staging (only needed when staging can't be checked live) | Staging deploy |
| `staging.review: { result, date, sourceHash, url }` | `/BWESEOQA <id> staging` | Staging review |
| `staging.approval: { approvedOn, source, sourceHash }` | Any skill, only from the owner's words | Owner approves on staging |
| `hold: { since, scope, reason, source }` | Any skill, only when the owner pauses a page; removed when they say go | Owner decision |
| `status: published`, `publishedOn`, `postPublication.*`, `nextReview` | `/BWESEOPublish` (production only — never from a staging check) | After the production deploy |
| `postPublication.searchConsole.indexingRequest/requestedOn/requestSource` | `/BWESEOPublish` or `/BWESEO`, only from the owner's word | Owner reports |
| `postPublication.searchConsole.liveUrlTest { result, testedOn, availableToGoogle, canBeIndexed }` | `/BWESEO`, only from the owner's word | Owner reports the Live URL Test |
| `postPublication.searchConsole.indexed { status, verifiedOn, lastCheckedOn, evidence, source }` | `/BWESEO` / `/BWESEOSearchConsole`, only with real evidence (URL Inspection says the URL is on Google) — never from a request, a passed test or a sitemap | Owner reports URL Inspection |
| config `analytics.searchConsole` `configured`, `propertyType`, `verifiedProperty`, `verificationMethod`, `verifiedOn` (never a token) | `/BWESEOSetup`, `/BWESEO`, from the owner's word | Site-level, once |
| config `analytics.searchConsole.sitemap { url, submitted, status, verifiedOn, lastRead, discoveredPages }` | `/BWESEO`, from the owner's word | Site-level, once |
| `postPublication.monitoring.completed.review7/30/90`, `nextReview` | `/BWESEOSearchConsole` | Each review |
| `refresh`, `status: update-needed`, `lastRefreshedOn` | `/BWESEORefresh`, `/BWESEOSearchConsole` | Improve |
| `issues[]` (top level) | `/BWESEOAudit`, `/BWESEOTechnical`, `/BWESEOSchema`, `/BWESEOLocal`, `/BWESEOInternalLinks` | Audits and fixes |
| profile `openQuestions[].blocks/blocking/answeredOn` | Any skill | When a fact is missing / answered |
| config `analytics.searchConsole.sitemapSubmission` | `/BWESEO` / `/BWESEOPublish`, from the owner's word | Owner reports |
| config `environments` | `/BWESEOSetup` (verified values only) | Setup / when hosting changes |

Store only what is useful. Unknown history stays empty — never back-filled with guesses.

## Google workflow state (engine 1.7.0)

> **PUBLISHED does not mean DISCOVERED. DISCOVERED does not mean CRAWLED. CRAWLED does not mean INDEXED.
> INDEXED does not mean RANKING WELL. RANKING / TRAFFIC does not necessarily mean BUSINESS CONVERSIONS.**
> The objective is measurable customer acquisition, not vanity SEO metrics.

Rows per published page (in order): Google readiness → Sitemap includes this page → [site] Search Console setup →
[site] Sitemap registered → Live URL test (optional) → Indexing requested (optional) → Google discovered → Google crawled →
Google indexed → Monitoring. The chosen next action is the first unfinished of: **readiness** (`google-readiness`, or
`fix-google-readiness` when it failed / the page is missing from the sitemap) → **Search Console setup** (site) →
**sitemap registration** (`reconcile-sitemap` via the API, else the manual `verify-sitemap`) → **monitoring scheduled** →
**status check** (`check-google-status` via the API when due; else the manual `verify-indexing` at a review date) →
**WAIT — "monitor Google discovery/indexing"**, naming the stage ("not yet discovered", "discovered, not yet crawled",
"crawled, not yet indexed"). Live URL test and Request Indexing are **optional accelerators**: recommended only when
`analytics.searchConsole.requestIndexing` is `"recommended"`, and never repeated once recorded. Site-level facts are
inherited by every page — a new page never repeats Search Console setup or sitemap registration. `state.google` carries the
site-level record; `state.pages[].google` the page-level one. Evidence rules: `readiness PASSED`, `DISCOVERED`, `CRAWLED`
and `INDEXED` each need a date and a source, or they read as UNKNOWN.

## Installation state (engine 1.7.0)

`state.install` = `installed` (a receipt exists: version, schema, integrity verified / modified / missing, update available) ·
`legacy` (SEO records but no receipt — flagged small, never blocking) · `not-installed`. A project with no `seo/seo-config.json`:
not installed → next step `/BWESEOInstall`; installed → `/BWESEOSetup`. Installing the engine and setting up a customer are
separate phases.

## Where the live check runs (engine 1.6.0)

A host that serves the site must not fetch its own zone — on an edge runtime the request doesn't reach the
public site and can return a false 522. `seo-config.json → environments.health` = `{ strategy: "browser" |
"server" | "off", endpoint?: "/" }` (default `browser`: the admin's browser probes; the server only evaluates a
sanitized result). `server` fetches only targets `selfFetchRisk` clears; a skipped target is `UNKNOWN` health
with the reason — never a failure, never a conflict, never an action. The CLI probes from the developer's machine
and is unaffected. Provider names never appear in lifecycle logic. See the project's `SEO-OPERATIONS.md`.

## Lifecycle vs live site health (engine 1.5.0) — read this first

> **LIFECYCLE STATE AND LIVE SITE HEALTH ARE INDEPENDENT. A failed availability check must never automatically reverse a completed SEO lifecycle milestone.**

Lifecycle = historical workflow truth (recorded milestones with dates). Health = a current observation
(`state.liveHealth`, status HEALTHY / DEGRADED / UNAVAILABLE / CHECK_FAILED / UNKNOWN). Search Console
state and deployment state are their own truths. One failed observation never overwrites another
system's verified history. The ONLY thing that reverses a completed Production milestone is verified
evidence of a deliberate event, recorded as `production.reversal { kind: rollback|removed|reverted, date,
source, evidence }` (the validator rejects one without source and evidence) or the owner changing it.
A failed check recommends `investigate-health` ("Re-check" on the first failure, "Investigate" after 3
consecutive failures, tracked in `seo/data/live-health.json` via `--record-health`) — never a deploy,
QA, staging, approval, Search Console or indexing step, and never `/BWESEOPublish`.

## Live checks are health, not lifecycle (engine 1.4.1)

`probeLive` classifies each probe (`classifyProbe`): `ok`, `redirected` (2xx at another path — judged by
its destination), `missing` (404/410) or `unavailable` (5xx incl. 520–524, 429, timeout, network, other
4xx). **Only `missing` and a redirect to another page** become a conflict (`PRODUCTION PAGE MISSING` /
`MOVED`, action `conflict-not-live` → `/BWESEOTechnical`, an investigation); the recorded lifecycle (status,
`publishedOn`, `postPublication`) is left exactly as it is. **`unavailable` is a health failure**: it is
reported in `state.liveHealth` as `LIVE SITE CHECK: FAILED / UNAVAILABLE` (or PARTLY FAILED when only some
pages failed), never in `conflicts`, never changes a row, and never recommends `/BWESEOPublish`. The probe
retries transient failures once and has a circuit breaker: when the home page is unavailable after the
retry no other page is requested. `/BWESEOPublish` is recommended only from independent lifecycle
evidence (e.g. live with no post-publication record), never from a failed health check.

## Choosing the ONE next action

Most urgent first. Within a level: P1 before P2, then roadmap order.

1. Wrong project (guard) → stop. No SEO setup → `/BWESEOSetup`. Broken SEO data → fix it.
2. Profile questions marked `blocking` → ask only those.
3. No audit → `/BWESEOAudit`; no opportunities → `/BWESEOOpportunities`; no roadmap →
   `/BWESEOContentPlan`.
4. **Production not indexable** (CRITICAL SEO ERROR), then **records contradict reality**
   (published page missing / staging-only, live before QA, files missing), then staging not hidden
   at all.
5. **Critical / blocking site issue.**
6. **Finish what's in flight**, closest to live first: on production but not checked →
   `/BWESEOPublish`; post-publication problems; owner's Search Console request (manual); QA failed
   → fix; QA stale → re-run; no QA → `/BWESEOQA`; QA passed → **deploy to staging**; on staging →
   **staging review** (`/BWESEOQA <id> staging`); staging review failed → fix; staging review passed →
   **owner's staging approval**; approved on staging (or QA passed, when there's no staging) → owner's
   production deploy approval; a draft → finish; approved → `/BWESEOCreatePage` (or the blocking
   question if it's blocked). **Google steps are never recommended until the page is on
   production and `/BWESEOPublish` has passed.** Then, strictly in order, the first unfinished of:
   Search Console setup (site-level; `unknown` → ask the owner to confirm) → Live URL Test (a
   failure blocks: fix and retest, never request indexing) → Request Indexing (retry on
   `REQUEST FAILED`) → sitemap verified (site-level) → monitoring scheduled → **indexing check**
   (only when a review date has arrived and the page is not yet verified indexed, and not already
   checked since) → otherwise **WAIT — "Waiting for Google — not yet verified as indexed"**. A
   finished or declined step is never asked again. `Indexed by Google` completes only with a
   recorded `indexed` verification (date + evidence + source); monitoring starts only then.
7. A 7/30/90-day review that's due → `/BWESEOSearchConsole` (or the owner's export first).
8. High site issues (approved → fix with the matching skill; otherwise ask).
9. A page with recorded refresh evidence → `/BWESEORefresh` ("improve before you create").
10. The next roadmap item → present the top P1 options and ask the owner to approve **one**.
11. Medium site issues; stale pages; stale audit or profile.
12. A page on hold (a reminder only — never nagged ahead of real work).
13. **WAIT** — a published page is waiting for data: say so and give the next review date.
14. Nothing due → say so.

### Pacing

A page waiting for Search Console data does **not** stop work on the next roadmap page. `/BWESEO`
only says "wait" when nothing else useful is left — and it never proposes rewriting a page just to
create activity (see `content-refresh.md` → New pages).

### Holds

`hold.scope: "deploy"` (the default): the page may be built, QA'd, deployed to staging, reviewed on
staging and approved on staging, but the **production** deployment shows ON HOLD and is never
proposed until the owner says go. `hold.scope: "all"`: nothing happens on the page.
While a page is on hold `/BWESEO` moves on to the next useful work.

### Blockers

A page is BLOCKED by an unanswered profile question listed in its `blockedBy`, or whose `blocks`
names the page (id or path). Ask **only** the blocking question for the item that's next — never
the unrelated optional ones, and never something the project's files or verified sources already
answer.

## Approval gates (state awareness never removes them)

`/BWESEO` recommends; it does not skip a gate. It stops for the owner's explicit yes before:
creating a public SEO page, deploying (staging per the project's standing rule; production always),
pushing, major navigation changes, substantial changes to a live page, adding any paid service,
changing a verified business fact, changing prices, or publishing any claim without a verified fact
behind it. One approval covers one action — **approving a page on staging is not permission to
deploy it to production** unless the project's own workflow explicitly says so.

## Manual actions

Anything only the owner can do is labelled **USER MUST DO THIS** with numbered steps and the exact
URL: Search Console URL inspection / Request Indexing, Search Console exports, sitemap
confirmation, answering a question. The owner reports back in chat; the skill records it with a
`source` of `owner:<date> chat`.

## Output

Default: the short dashboard from `seo-state.mjs` — which always starts with the environment block
(Environment · Production domain · Staging domain · Indexing actions), so nobody has to guess which
environment is being described — then WHAT WE ARE DOING / WHY IT MATTERS / WHAT
HAPPENS NEXT, then one question ("Would you like me to go ahead?"). "Show details" / "full SEO
status": `seo-state.mjs --details` (every page, issue, blocker and the full action list), or
`/BWESEOReport` for a performance report.
