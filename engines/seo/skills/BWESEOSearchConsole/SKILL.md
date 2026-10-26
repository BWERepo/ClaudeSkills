---
name: BWESEOSearchConsole
description: The Google Search side of the BWESEO engine for the current website project. (1) Registers the site's sitemap with Search Console through the OFFICIAL Search Console API, idempotently (an already-registered sitemap is reported, never resubmitted), only when the project has enabled the API and its credential exists. (2) Checks each production page's Google discovery, crawl and index status with the official URL Inspection API (read-only) and records each stage separately with its evidence - INDEXED is only ever set from Google's own report. (3) Analyzes performance (API or an owner-supplied export in seo/data/search-console/) - impressions, clicks, CTR, position, queries, and conversions where analytics exists - treats zero data as valid, and runs the 7/30/90-day reviews. Never simulates Request Indexing, never uses Google's Indexing API for ordinary pages, never touches staging, never stores or prints credentials, never fabricates data. Also reads the site's Google Index Monitoring snapshot (which production URLs are indexed, which need attention, and how long new pages typically take). (4) Keyword performance (engine 1.10.0): for each registered keyword and its target page - `keywords add|remove|list|validate|pull|refresh|status|analyze|table|page|discovered|investigate` - which page is meant to rank, whether it exists / is in the sitemap / is indexable, whether Google has indexed it (confirmed, inferred or unknown, with the source), what Google shows for the query (impressions, clicks, CTR, average position), wrong-page and cannibalization detection, discovered queries and evidence-based recommendations; from the site's OWN Search Console data, never a Google search. Use when the user says "Search Console", "keyword performance", "which page ranks for", "GSC data", "index status", "which pages are indexed", "register the sitemap", "is the page indexed", "analyze queries", or invokes /BWESEOSearchConsole, in any website project.
---

> `$BWESEO_ENGINE` = the canonical BWESEO engine directory: `$BWESEO_ENGINE_HOME` if set, else the `path` in
> `~/.claude/bweseo/engine-location.json` (see `/BWESEOInstall`). Engine code lives in `$BWESEO_ENGINE/src`, methodology in
> `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`.

# BWESEOSearchConsole

Engine: `$BWESEO_ENGINE/` (Google layer: `seo/tools/seo-google.mjs`). Read
`docs/methodology/search-console.md`. **Architecture decision:** this is the one Google skill (no separate
`/BWESEOGoogle`): readiness is recorded by `/BWESEOPublish`, everything that talks to Google or reads Google's
data lives here, and `/BWESEO` remains the only door the owner needs.

**Hard rules (permanent guardrails)**
- Only the **official Search Console API** (sitemaps, URL Inspection, Search Analytics). **Never** simulate the
  "Request Indexing" button — it stays a manual, optional accelerator.
- **Never** Google's **Indexing API** for ordinary pages (services, pricing, articles…). It is only for
  `JobPosting` / `BroadcastEvent` content via an explicit qualified adapter; default `indexingApiEligible: false`.
- **Production URLs only.** Staging / preview / local URLs are never submitted, inspected or queried.
- **Credentials never** in the repo, the inventory, client code, logs or the Admin card. The config holds only a
  NAME (`analytics.searchConsole.credentialsSource: "env:…"`); the tool reads it from the environment at call time.
- **Never infer** a later stage from an earlier one. Published ≠ discovered ≠ crawled ≠ indexed ≠ ranking well ≠
  business conversions. Sitemap Success, a passed Live URL Test, a Request Indexing click, a Googlebot visit or
  HTTP 200 are **not** evidence of indexing.
- A live-site **health** failure (5xx / 522 / timeout) never changes Google state and never triggers a sitemap
  resubmission or a republish.

## 0. Project guard and API status

`/BWESEO` Step 0, then `node seo/tools/seo-google.mjs api-status` — booleans only (enabled? credential present?
property, sitemap URL). If the API is **not enabled / not configured / credential missing**, say exactly what that
means: readiness, sitemap membership and the manual steps still work; sitemap registration, status checks and
performance then use the owner's manual steps or exports. Explain how to enable it (service account added as a
user of the property; key stored in the host's secret store; `enabled` + `credentialsSource` NAME in config). Do
not stop the wider workflow because an optional integration is unavailable.

## 1. Sitemap registration (site-level, once)

`node seo/tools/seo-google.mjs sitemap` is a **dry run** (`would-submit` / `none`). Only after the owner agrees,
`… sitemap --submit` performs the one API submission. It is **idempotent**: "Sitemap already registered with
Google Search Console." is a success, not a failure; it resubmits only when the sitemap is missing, Google
reports errors, or `--force` is given. Record the returned site-level record in
`seo-config.json → analytics.searchConsole.sitemap` (`submitted`, `submissionMethod: "api"`, `submissionAt`,
`status`, `verifiedOn`, `lastRead`, `discoveredPages`). The reported page count is site-wide and is **not** proof
that any one URL is included or discovered.

## 2. Discovery / crawl / index status (page-level)

`node seo/tools/seo-google.mjs inspect <page id>` (URL Inspection API, read-only) returns separate
`discovered`, `crawled` and `indexed` records, each with `source` and evidence. Record them under the page's
`postPublication.google.discovered|crawled` and `postPublication.searchConsole.indexed`, and set
`postPublication.google.lastCheckedOn`. `indexed: INDEXED` only when Google's coverage state says the URL is on
Google; otherwise `NOT VERIFIED` with `lastCheckedOn`. Without the API, the owner reads URL Inspection at a
review date and reports the result; record exactly that, with `source: "owner:<date> chat"`.

## 3. Performance and the 7 / 30 / 90-day reviews

`node seo/tools/seo-google.mjs performance <page id> --days 28` (or an owner export in
`seo/data/search-console/<date>/`, path from `analytics.searchConsole.dataDir`; no data → explain how to export
it: Performance → set the date range → Export → CSV; never commit raw exports — `seo/data/` is gitignored).
Record `postPublication.google.performance` (`checkedAt`, `windowDays`, `source`, `impressions`, `clicks`, `ctr`,
`position`, `queries`, and `conversions` only where analytics really provides them).

- **Zero is valid.** A new page can have 0 impressions and 0 clicks: record it and say "No Search Console
  performance data yet." Never estimate, never call it a failure.
- **The objective is customers, not traffic.** For a lead-generation business that means qualified prospects who may
  request or discuss the business's service (the project's `conversion.primary`). Weigh queries by commercial relevance; never optimize
  purely for impressions that are commercially irrelevant.
- Follow `docs/methodology/search-console.md`: match pages to inventory entries; route findings to refresh /
  create (via opportunities + cannibalization) / technical / conversion. Write
  `docs/seo/reports/search-console-<YYYY-MM-DD>.md`.
- Runs the review checkpoints `/BWESEOPublish` scheduled (`postPublication.monitoring`, `nextReview`): record each
  as done in `postPublication.monitoring.completed.review7|review30|review90` (today's date) and set
  `nextReview`. When the data shows a real problem, record `refresh: { trigger, evidence, flaggedOn, source }` —
  /BWESEO only recommends a refresh when that evidence exists. Hand expand / revise / consolidate decisions to
  `/BWESEORefresh`.

## 4. Google Index Monitoring (site-wide, engine 1.9.0)

The site runs its own scheduled monitor (read `docs/methodology/google-index-monitoring.md`) that inspects every
**production** URL with the URL Inspection API, reads Search Analytics and the sitemap status, keeps a history of state
changes and milestones, and stores a compact snapshot. This skill only READS it:

- `index pull` — `node seo/tools/seo-google-index.mjs pull` saves the monitor's summary and registry to
  `seo/data/google-index/` (ignored by git) using the developer's own wrangler login. No secret is involved.
- `index status` — `node seo/tools/seo-google-index.mjs status`: Search Console, Sitemap, Indexing, indexing rate (a plain
  ratio, never a score).
- `index investigate` — `node seo/tools/seo-google-index.mjs investigate`: the URLs needing attention, each with Google's own
  wording, last crawl, plain-language meaning and the checks to make.
- `index explain <path>` — one URL, with its timeline (published → discovered → crawled → indexed → first impression).
- `index impressions` — indexed pages with no impressions: review query targeting, titles and content (not an indexing problem).

Rules: report only what Google reported; **never** call a URL indexed or not indexed without the monitor's data; an API
outage is "Google status temporarily unavailable", never "not indexed"; recommendations are diagnostic checks, not
guarantees about ranking; never edit a canonical tag until the reason Google disagrees is understood; never automate or loop
indexing requests; staging is never monitored or submitted. Website health and Google-indexing health are reported separately.

## 4b. Search watch (site-wide, on by default)

`node seo/tools/seo-watch.mjs status` shows whether the workflow is on, the pages tracked, the inbox and the last daily run. It keeps the sitemap current from the
website's page events (`notify`, `sync`), checks new pages plus a rotating sample every day (`daily`), flags pages Google has not indexed (**only** from URL
Inspection evidence), crawl failures and unexpected canonicals (`findings`, which also feed `seo-queue.mjs build`), and writes a weekly report with the three most
useful fixes (`weekly`). `enable` / `disable --by "<name>"` switch it on or off. Report what the commands print; never call a page not indexed without the
inspection evidence, and never present the weekly comparison as proof of cause. Details: `docs/methodology/search-watch.md`.

## 5. Keyword performance (site-wide, engine 1.10.0)

Read `docs/methodology/keyword-performance.md`. The registry is `pages[].keywords` (ONE primary + secondary keywords) in the site's own
`seo/content-inventory.json`; data comes from the site's own Search Console. **Not a SERP tracker: never scrape or simulate Google.**

- `keywords add <page-id> "<keyword>" [--primary]` / `keywords remove` / `keywords list` / `keywords validate` —
  `node seo/tools/seo-keywords.mjs …`. A keyword is attached to an EXISTING page; it never creates one. Propose keywords from the verified
  profile and the page's content and let the owner approve them. Several look-alike phrases are ONE intent on ONE page.
- `keywords pull` — copies the site's stored keyword data from its production KV (developer's own wrangler login, read-only).
  `keywords refresh [--range 7d|28d|3m] [--force] [--targets]` calls Search Console directly (production only; credential from the environment by NAME).
  Respect the cache and cooldown: do not loop refreshes; say "Last updated …" and the date range every time.
- `keywords status` / `table [--filter …]` / `analyze "<keyword>"` / `page <path>` / `investigate` — show the results in plain words; lead with the status,
  the WHY and the next action. Show the range and `Last updated`.
- `keywords discovered` — queries Google shows that nobody registered. The owner may ignore, monitor, add as secondary/primary or investigate
  (`--query "<q>" --action ignore|monitor|investigate|add-secondary|add-primary [--page <id>]`). Never create a page from a discovered query; "investigate"
  routes to `/BWESEOOpportunities`.

Rules: keep page exists / discoverable / in sitemap / crawlable / indexable / indexed / impressions / clicks / appears for the query / Google shows the intended
page / organic traffic as SEPARATE facts; indexing is **confirmed** only from URL Inspection (say the source and date), **inferred** from impressions alone, otherwise
**unknown** with the manual step; new pages and sites with no data are "insufficient data", not failures; indexed-with-zero-impressions is not a failure; use
"average position", never "ranking"; a wrong page or competing pages is a review, not an automatic change (no URL, canonical or deletion); production only;
never print or store credentials.

## Errors degrade, they don't corrupt state

`not-configured` / `disabled`, `permission-denied` (the service account isn't a user of the property), `quota`,
`network`, `api-error`, sitemap unavailable / malformed, URL missing from the sitemap, robots-blocked, noindex,
canonical mismatch, "Google discovery / crawl / index pending", "Search Console data unavailable": report each as
an actionable status. None of them rewrites lifecycle, deployment or Google history.
