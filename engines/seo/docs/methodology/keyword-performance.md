# Keyword Performance System (engine 1.10.0)

Answers one question for a website:

> If someone searches Google for a keyword we target, **which page is meant to rank**, **has Google indexed it**, **is Google
> showing it for that query**, and **how is it performing?**

It is a reusable BWESEO capability. The engine owns the logic, schema and tests. **Each website owns its own** keywords, pages,
sitemap, Search Console property, analytics data, credentials/configuration and SEO history. Nothing about one website is ever
copied to another.

**This is not a SERP tracker.** Nothing here searches Google, scrapes a results page or simulates a search. It reads the
site's **own** Search Console data (Search Analytics, URL Inspection, sitemaps), crawls the site's **own** pages and reads
its **own** sitemap. "Average position" is Search Console's average for the period — it is never called a live ranking.
A future authorized third-party SERP provider could be added behind the same data shapes; none is used or required.

## Architecture

```
site's seo/content-inventory.json   pages[].keywords  ← the registry (one primary + secondary keywords per page)
        │
        ▼
keyword-registry.mjs   pure: flatten, validate, add/remove, same-intent hints, discovered-query decisions
keyword-target.mjs     pure: target-page facts (status, robots, canonical, sitemap, H1, topic, links) + sitemap checks
keyword-performance.mjs pure: Search Analytics rows → keyword/page analysis, wrong-page, cannibalization, opportunities,
                              discovered queries, priorities, dashboard table, page view, plain-language text
keyword-performance-run.mjs  fetch + cache + quota + orchestration (Worker-safe, adapter-driven)
seo-keywords.mjs       developer CLI (validate / list / add / remove / refresh / pull / status / analyze / table / page /
                       discovered / investigate)
seo-state-core.mjs     /BWESEO reads the summary and recommends the NEXT useful action
```

There is **one engine** and no parallel SEO system: the Search Console client is the existing `gsc-client.mjs`; indexing
state is the existing Google index monitor's records (`gi:registry`, URL Inspection); URL/sitemap parsing is
`index-monitor.mjs`; secrets handling, production-only guards and the store adapter are the existing ones.

### Where the engine runs

| Part | Where | Notes |
|---|---|---|
| Pure rules, registry, page/sitemap checks | anywhere (Node 18+, Cloudflare Worker, browser) | no I/O |
| `refreshKeywordPerformance`, `refreshTargets`, `getKeywordPerformance`, `lookupKeyword` | a site's scheduled handler or admin action | adapter-driven; **server-side only** |
| `seo-keywords.mjs` | the developer's machine | `refresh` reads the credential from the environment by NAME; `pull` uses the developer's wrangler login |
| Admin dashboard, keyword lookup box, endpoints | **each website** | built per site from the read model below |

The engine repo has no database, UI or deploy of its own: it ships the view-models and text, and the site renders them.

## Data (no database)

**Registry** — in each site's own `seo/content-inventory.json`:

```json
{
  "pages": [{
    "id": "metric-converter", "url": "/tools/metric-imperial-converter", "title": "Metric to Imperial Converter",
    "status": "published", "priority": "P1", "type": "utility", "indexable": true,
    "keywords": {
      "primary": "metric to imperial converter",
      "secondary": ["metric converter", "imperial converter", "kilometers to miles", "kg to pounds"],
      "searchIntent": "tool", "addedOn": "2026-10-03", "notes": ""
    }
  }],
  "keywordDecisions": [{ "query": "convert kilograms into american pounds", "decision": "monitor", "on": "2026-10-03" }]
}
```

`registryOf()` flattens this into the record the spec describes: `siteId, keyword, targetUrl, pageTitle, primaryKeyword,
secondaryKeywords[], searchIntent, priority, status, dateAdded, lastChecked, notes` (+ `role, pageId, canonicalUrl, pageType,
category, indexable`). Existing inventory fields (URL, title, type, priority, status, canonical, created) are reused — they are not
duplicated. `canonicalUrl`/`category` are read if the page records them. `sitemapIncluded`, `indexable`, `internalLinkCount` and
`lastCrawled` are **measured**, not stored: they come from the target-page check and the index monitor, so they cannot go stale in the file.

**Stored measurements** (the site's own KV/store, keys `kw:*`; the monitor's `gi:*` keys are only read):

| Key | Holds |
|---|---|
| `kw:snapshot` | the last Search Analytics pull (query × page rows, compact), its range, the previous period, `fetchedAt` |
| `kw:targets` | cached target-page and sitemap checks |
| `kw:meta` | last refresh time, last error, today's request count |

**History** is deliberately **not** stored as duplicate snapshots: Search Console returns up to 16 months on demand, so each pull also
fetches the **previous period of equal length** ("28 days ago: 120 impressions, now: 680"; "position 47.3 → 18.6"). The monitor's per-URL
state history already records indexing changes.

Never stored anywhere in the engine or the project's data folder: credentials, tokens, service-account keys.

## Keyword → target page

- A page has **one primary keyword** and any number of **secondary** keywords. `addKeyword` refuses a second primary unless
  `replace` is given (the old primary becomes secondary), refuses a phrase already owned by **another** page unless the owner
  allows it, and **never creates a page**.
- Phrases are compared normalized (case, punctuation, spacing). `similarKeywords` hints when phrases on one page look like **one
  search intent** (word-set overlap, a hint only). The validator lists them: "These phrases belong on ONE page; they do not need
  separate pages." The same phrase on two pages is a warning (potential cannibalization by design).
- Wording that differs but means the same ("kg to pounds" vs "kilograms to lbs") is **not** detected by word overlap. Search Console
  evidence — which page Google shows for each — is what settles intent.

## Target-page validation (`keyword-target.mjs`)

Facts: URL exists, HTTP status, redirect, indexable, robots directives (meta + `X-Robots-Tag`), crawlable by `robots.txt`, canonical
(self / elsewhere / missing), in the sitemap, `<title>`, meta description, H1s, structured-data types, internal links pointing to the page
and orphan status, and whether the page is **substantial**.

No keyword-density scoring. "Topic clear" asks only whether the primary keyword's words appear in the **title, the H1 and the opening copy** — evidence for a
person to confirm, not a score. A page with almost no server-rendered text is "unknown" (it may be drawn by JavaScript), not "thin".
`indexable: yes` means "no noindex and not blocked" — it does **not** say Google has indexed the page.

Sitemap checks (`analyzeSitemap`): detected or not, malformed entries (wrong host, http, not a URL), duplicates, non-canonical forms,
redirects, 404/410, 5xx, noindex pages and pages whose canonical points elsewhere. Sitemap membership is **not** indexing.

## Indexing status — confirmed, inferred, unknown

| Shown | Meaning | Source |
|---|---|---|
| **Indexed — confirmed** / **Not indexed — confirmed** | Google's URL Inspection API said so | the index monitor's record (`inspect.status: OK`), with the date |
| **Probably indexed — inferred** | the page has Search Console impressions, so Google has it; URL Inspection has not confirmed | performance data; **never** shown as confirmed |
| **Unknown** | no definitive status; reason and manual step are shown | e.g. "Definitive indexing status is not available through the configured API. Inspect this URL in Google Search Console." |

An inspection **failure** (quota, auth, network) is "unknown — not the same as not indexed". Staging/preview/local URLs are never inspected.

## The 11 separate states

Every analysis carries a `ladder` that reports each of these independently, with its basis — never one from another:
page exists · is discoverable · is in the sitemap · is crawlable · is indexable · is indexed (confirmed / inferred / unknown) · receives
impressions · receives clicks · appears for the intended query · Google shows the intended page · generates organic traffic.

## Search Console data

API: **Search Analytics `query`** (`dimensions: ["query","page"]`) → clicks, impressions, CTR, average position per query × page.
Ranges: last 7 days, last 28 days (default), last 3 months, or a custom `{startDate, endDate}`; the end is held back 2 days for data lag
and **every screen shows the range**. A brand-new site with nothing in 28 days is automatically widened once to 3 months, and says so.

### Wrong page (TARGET PAGE MISMATCH)
If another page has the most impressions for a keyword (and enough to matter) the keyword is flagged: "Google appears to associate
`/other` with this query rather than `/intended`." The recommendation lists intent, titles/H1s, overlapping content, canonical tags and
internal links. **Nothing is changed automatically** — no URL, canonical or deletion.

### Cannibalization
Two or more pages each with meaningful impressions **and** a meaningful share for the same query are flagged **for review**, with the
evidence (impressions/clicks/position/share per page, and how much of each page's impressions come from *other* queries — a page
whose impressions mostly come from other queries probably overlaps only incidentally). Multiple ranking pages are not assumed harmful.

### Discovered keywords
Queries the site gets impressions for that are **not registered**, with impressions, clicks, average position, the page Google shows
and a suggestion (add as secondary to the page that already shows it / an existing near-match; otherwise *investigate*). The
administrator can **ignore, monitor, add as secondary, add as primary, or investigate as an opportunity**. A discovered query **never
creates a page**; "investigate" only records the decision and points at `/BWESEOOpportunities`.

### Priorities (each with *why* and *actions with reasons*)
`FIX NOW` · `HIGH OPPORTUNITY` · `IMPROVE` · `MONITOR` · `HEALTHY` · `INSUFFICIENT DATA`

| Evidence | Result |
|---|---|
| noindex / robots-blocked / canonical elsewhere / 404 / server error; Google reports a blocking problem | FIX NOW |
| average position 8–20 with ≥ 100 impressions | HIGH OPPORTUNITY (striking distance) — fewer impressions: IMPROVE |
| ≥ 100 impressions, average position ≤ 10, CTR < 2 % | HIGH OPPORTUNITY (search-result presentation) |
| impressions but average position > 20 | IMPROVE |
| Google shows another page / pages compete | IMPROVE (review before changing anything) |
| strong position and CTR | HEALTHY |
| indexed (confirmed), zero impressions, page not new | MONITOR — explicitly *not* a failure (demand, competition, page age, links) |
| zero impressions on a new page or a site with no data; unindexed-but-known within the grace period | INSUFFICIENT DATA |
| not indexed after the grace period | IMPROVE |

When Google shows a different page, the blended query numbers describe *that* page, so position/CTR opportunities are not judged on them.
Thresholds are the engine's defaults and can be overridden per site in `analytics.searchConsole.keywordPerformance.thresholds`.

## Read model for a site's screens

`getKeywordPerformance(ctx, { inventory })` → `{ analyses[], discovered[], summary, snapshot, lastUpdated, lastError, sitemap, table(opts) }`
computed from **stored** data only (it never calls Google and never fetches a page).

- **Keyword table**: `tableRows` + `queryTable({ filter, sort, dir, q })`. Filters: `all, highest-impressions, highest-clicks, lowest-ctr,
  best-position, near-page-one, indexing-issues, target-mismatch, cannibalization, zero-impressions`; discovered queries are a separate list.
  Columns: keyword, target page, index status (+ confidence), impressions, clicks, CTR, average position, trend, issue, priority; each row
  carries `details` for the expandable view.
- **Page view**: `pageView({ path, … })` — indexing, sitemap, canonical, last-period performance, top queries, related pages, issues, opportunities.
- **Keyword lookup**: `lookupKeyword(ctx, { inventory, keyword })` and `formatKeywordAnalysis()` produce the plain-language
  "KEYWORD ANALYSIS" screen. The result says its source is "the site's own Search Console data (not a Google search)". An unregistered phrase
  still shows what the site's data says about it.

## Caching, rate limiting, errors

- A pull younger than 6 hours is served from cache without calling Google (`Last updated` is always available). A forced refresh has a
  15-minute cooldown and an own daily request ceiling (40 Search Analytics requests per UTC day, far under Google's quota).
- Target-page checks are cached 24 hours and limited to 25 pages per run.
- Failures never wipe data: `auth-failed`, `permission-denied`, `quota`, `network`, `timeout`, `budget`, `cooldown`, `not-configured`, `disabled`
  are typed results; the previous snapshot is kept and flagged `stale`. An API problem is never shown as "no impressions".
- Staging, preview and local never call Google (`not-production`), only production pages are fetched, and rows for any other origin are dropped.

## New websites

`Indexed: UNKNOWN`, zero impressions, no Search Console data are normal for a new site and are shown as **INSUFFICIENT DATA — "This
page/site is new and Google has not generated enough Search Console data yet. Continue monitoring."** — never as a failure. First-detected
dates come from the monitor's `publishedAt`/`discoveredAt`, else the inventory's `created`.

## Google APIs used, and what they can and cannot tell you

| API | Used for | Reliably provides | Does **not** provide |
|---|---|---|---|
| Search Console **Search Analytics** (`searchAnalytics.query`, read-only scope) | per query × page clicks, impressions, CTR, average position; discovered queries; wrong-page and cannibalization evidence | the site's own performance, up to ~16 months, ~2–3 days behind | live rankings; every query (rare queries are anonymized so totals can exceed row sums); impressions *before* the site was in Search Console; position for pages with no impressions |
| Search Console **URL Inspection** (via the index monitor) | confirmed indexed / not indexed with Google's own coverage wording, last crawl, Google-selected canonical | the real index state of one URL (≈ 2,000 inspections/day/property) | a *reason* beyond what Google states; indexing for many URLs at once; staging URLs |
| Search Console **Sitemaps** | whether the sitemap is registered and read, error counts | sitemap-level status | that any one URL is indexed |
| the site itself (crawl, `robots.txt`, sitemap file) | exists, status, robots, canonical, title, H1, links | facts about the pages | anything about Google |

Not used: Google's **Indexing API** (only for job/broadcast pages), SERP scraping, any paid SERP provider.

## Installing on another website

1. `/BWESEOInstall` (or `--update`) copies the **engine files only**: `keyword-registry.mjs`, `keyword-target.mjs`, `keyword-performance.mjs`,
   `keyword-performance-run.mjs`, `seo-keywords.mjs`, their `.d.mts` types and tests, plus the schema updates. It copies **no** keywords,
   Search Console data, analytics, history, sitemap data, credentials or other sites' anything.
2. The site adds **its own** configuration:
   ```json
   "analytics": { "searchConsole": {
     "enabled": true, "credentialsSource": "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON",
     "keywordPerformance": { "enabled": true, "defaultRange": "28d", "staleAfterDays": 7 },
     "indexMonitor": { "enabled": true, "snapshot": { "source": "cloudflare-kv", "kvNamespaceId": "<32 hex id>" } } } }
   ```
   and its **own** Google service account (a user of its Search Console property) in the host's secret store.
3. Register keywords: `node seo/tools/seo-keywords.mjs add <page-id> "<keyword>" --primary`.
4. Give the data a home. Either run `seo-keywords.mjs refresh` (direct, production only) from the developer's machine, or — for a
   Cloudflare site — call `refreshKeywordPerformance` / `refreshTargets` from a scheduled Worker with `kvStore(env.KV)` and
   `createSearchConsoleClient({ config, env })`, then `seo-keywords.mjs pull`.
5. Build the admin screen from the read model (keyword table, keyword lookup, page view, discovered keywords) behind the site's own admin
   authentication. Keep Google calls server-side; the browser only receives view-models.
6. `node seo/tools/validate-seo-data.mjs` and `node seo/tools/seo-state.mjs` — `/BWESEO` now includes the keyword block and next actions.

### Site adapter contract (same shape as the index monitor)
`store {get,put,delete}` (`kvStore`, `memoryStore`) · `client` (`createSearchConsoleClient`) · `site {productionUrl, stagingUrl?, sitemapUrl}` ·
`environment` (must be `"production"` to call Google) · optional `fetchPage(path) → {status, redirectedTo?, xRobotsTag?, html}` and
`fetchText(url)`. Suggested endpoints for a site's admin: `GET /seo/keywords`, `GET /seo/keyword?q=`, `POST /seo/keywords/refresh`,
`POST /seo/keywords/discovered` — all behind admin authentication.

## /BWESEO integration

`state.keywords` (config `keywordPerformance` + the registry + `seo/data/keyword-performance/summary.json`) adds a **Keyword performance** block and one
next action, in this order: register keywords → pull data → resolve indexing/discovery problems → review wrong-page/competing pages →
improve search-result presentation (good position, weak CTR) → improve relevance and internal links (impressions, weak position) → review targeting
(indexed, no impressions) → protect what works. "All new / insufficient data" yields **no** action — waiting is the recommendation.
These are SEO findings: they never become website conflicts and never recommend a redeploy. `/BWESEO keyword <phrase>` answers the lookup.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `not-configured` / `disabled` | `analytics.searchConsole.enabled`/`credentialsSource` missing, or the named env var is not set where the code runs |
| `permission-denied` | the service account is not a user of the Search Console property |
| `auth-failed` | key revoked, expired or malformed |
| `quota` / `budget` / `cooldown` | wait; the previous data is kept and shown as stale |
| every keyword "INSUFFICIENT DATA" | the site is new, the property was just added, or the 28-day range is empty — check the Last updated and range lines |
| "Google shows another page" for a good page | normal for a few days after a change; check titles/H1s and canonicals before acting |
| a keyword has no data though the page ranks | Search Console hides rare queries; the keyword may be anonymized |
| `Indexed: UNKNOWN` | the index monitor has not inspected the URL (or its inspection failed); run its refresh |

## Testing

`npm test` runs `src/keyword-performance.test.mjs` (registry, target page, sitemap, parsing, ranges, indexing states, analysis, wrong page,
cannibalization, discovered queries, table, runner caching/quota/errors/staging), `src/keyword-state.test.mjs` (/BWESEO integration and validator) and
`src/seo-keywords.test.mjs` (CLI). All Google access is mocked; no test touches the network.
