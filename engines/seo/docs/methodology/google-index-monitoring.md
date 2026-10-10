# Google Index Monitoring (engine 1.9.0)

> **Which production URLs does Google know about, which are indexed, which have problems, and which need attention?**
> Answered from Google's own Search Console reports — never inferred from the sitemap, from traffic, or from a deployment.

This is a **reusable BWESEO capability**. The engine holds the generic code; each website holds its own configuration,
credentials and storage. Nothing about any one business (domain, Search Console property, URLs, keys) is ever copied by
`/BWESEOInstall`.

## The lifecycle — separate facts, never one inferred from another

```
DISCOVERED → PUBLISHED → IN_SITEMAP → SUBMITTED → CRAWLED → INDEXED → RECEIVING_IMPRESSIONS
```

| Stage | Meaning | Evidence |
|---|---|---|
| DISCOVERED | The site's monitor found the URL in the site's own page list | the site's registry |
| PUBLISHED | It is a live production page | the site's registry (optional `publishedAt`) |
| IN_SITEMAP | The site's sitemap lists it | the sitemap |
| SUBMITTED | Google reports the URL under a sitemap | URL Inspection `sitemap[]` |
| CRAWLED | Google has crawled it | URL Inspection `lastCrawlTime` |
| INDEXED | It is in Google's index | URL Inspection verdict `PASS` + coverage — **only** this |
| RECEIVING_IMPRESSIONS | It appeared in search | Search Analytics |

- Being in the sitemap does not mean indexed. Being crawled does not mean indexed. Being indexed does not mean receiving
  impressions. **Zero impressions never means "not indexed"**, and Search Analytics never overrides URL Inspection.
- **Index state** (what Google says now): `INDEXED`, `NOT_DISCOVERED_BY_GOOGLE`, `DISCOVERED_NOT_INDEXED`,
  `CRAWLED_NOT_INDEXED`, `BLOCKED_BY_ROBOTS`, `NOINDEX`, `CANONICAL_CONFLICT`, `FETCH_ERROR`, `REDIRECTED`, `DUPLICATE`,
  `UNKNOWN`, and `NOT_CHECKED` (never inspected — not a Google answer). Google's `coverageState` is free text, so it is
  matched by pattern; anything not recognised is `UNKNOWN` **with Google's original wording kept**.
- **A Google API failure is "Google status temporarily unavailable"** — the URL keeps its last known state. It never
  becomes NOT INDEXED.

## Website health vs SEO / Google-indexing health

Independent. A site can be `Production: HEALTHY` while `Google Indexing: ATTENTION REQUIRED`. An indexing problem never
feeds the live-site health check, never creates a "records don't match reality" conflict, and never recommends a deploy.

## Architecture

```
site's scheduler (Cloudflare Cron) ──► runMonitor()  ◄── admin: CHECK URL NOW / REFRESH GOOGLE STATUS / SUBMIT SITEMAP
                                         │
      discover()  ← the site's own page registry / sitemap          (adapter)
      store       ← Cloudflare KV (or any {get,put,delete})         (adapter)
      client      ← Search Console API, service account             (gsc-client.mjs)
                                         │
              index-monitor.mjs  (pure rules)   index-monitor-run.mjs  (storage + orchestration)
                                         │
                       gi:summary  ──►  seo-google-index.mjs pull  ──►  seo/data/google-index/  ──►  /BWESEO
```

| File (installed to `seo/tools/`) | Role |
|---|---|
| `gsc-client.mjs` | The one Search Console API client (service-account JWT, Worker-safe: no Node-only imports), sitemap reconcile, secret redaction, production-only guard |
| `index-monitor.mjs` | Pure rules: URL normalization, response parsing, state mapping, explanations, health, scheduling, quotas, throttling, alerts, timeline, timings, filtering/sorting, summary |
| `index-monitor-run.mjs` | Storage adapters (`kvStore`, `memoryStore`), registry sync, the monitoring run, on-page checks, sitemap submit |
| `seo-google-index.mjs` | Developer CLI: `pull`, `status`, `investigate`, `explain <path>` — reads what the monitor stored |
| `seo-state-core.mjs` | `/BWESEO` reads the snapshot (`googleIndexOf`) and recommends the next action |

No visitor request ever triggers a Google call. Monitoring runs only from a scheduled handler or an administrator action.

### Site adapter (what each website supplies)

```
store          { get(key) → json|null, put(key, json), delete(key) }
client         createSearchConsoleClient({ config, env })
site           { productionUrl, stagingUrl?, sitemapUrl }          from the site's own seo-config.json
discover()     → { items: [{ url|path, title, pageType, publishedAt?, itemId?, itemName?, indexable? }] }
fetchHtml(p)   optional — the page's own HTML (indexable? canonical? internal links?)
fetchStaging() optional — { reachable, xRobotsTag, html, robotsTxt } for the "staging stays hidden" check
```

`discover()` must come from the site's real page list (its registry, sitemap generator or database) — **never a hand-kept
list of pages**. A page that is switched off or removed is marked inactive (history kept); a failed discovery never marks
everything removed.

## Storage (Cloudflare KV adapter)

| Key | Content |
|---|---|
| `gi:registry` | one blob `{records:{<path>:record}}` — the list view never costs a read per URL |
| `gi:detail:<path>` | the latest **raw** Google response for one URL |
| `gi:meta` | site-level: Google API status, quota, sitemap, staging check, analytics, alerts, last run |
| `gi:summary` | the compact snapshot `/BWESEO` and the admin header read |
| `gi:links` | outbound internal links per page, for the internal-link check |
| `gi:lock` | soft lock so a cron run and a manual refresh never overlap |

A record holds the normalized fields (`indexState`, `google.*` — verdict, coverage, last crawl, fetch state, robots,
indexing state, Google/declared canonical, sitemaps, referring URLs, mobile/rich-result verdicts), `metrics`
(28-day impressions/clicks/CTR/position), `milestones`, `history` (every state change, newest last, capped) and the
schedule fields. Fields Google does not return stay `null`.

**Scale.** One registry blob is comfortable to a few thousand URLs. Beyond that, implement the same `store` interface on D1;
nothing else changes. A run never reads or writes per-URL keys except the one detail key of each URL it inspects.

## Scheduling, quotas and throttling

- **Priority** (each URL carries its own due time): 1 new or never-checked (daily) · 2 problem states (2 days) ·
  3 state changed recently (2 days) · 4 older indexed (14 days) · 5 stable (30 days). A failed check is retried after ~6 h.
- **Per run:** at most `batchSize` (default 20) inspections, inside the Worker's **subrequest budget** (the runner counts
  its own KV reads/writes and fetches and stops adding work first). Free-plan Workers allow 50 subrequests per invocation.
- **Daily cap** `dailyInspectionCap` (default 400) — deliberately far under Google's **2,000 URL Inspection queries per day
  per property (600 per minute)**. A `429`/quota error pauses Google calls until midnight UTC.
- **Stops early:** permission/authentication failures stop at the first call; three consecutive failures stop the run.
- **Administrator actions are throttled:** CHECK URL NOW is limited per URL (30 min); REFRESH GOOGLE STATUS (15 min). The
  answer says how long to wait and when the URL was last checked.
- **Cached:** sitemap status (24 h), Search Analytics (24 h), staging check (24 h).

## Search Analytics

One call per day with dimensions `page` + `date` over 90 days (paginated, up to 3 × 25,000 rows): 28-day clicks,
impressions, CTR and position per URL, and the **first-impression date** — only recorded when the search window reaches
back to when the URL began, otherwise earlier impressions might exist outside the window. Zero rows is a valid "no data
yet". Data lags by about two days.

## The indexing timeline

Per URL, built **only** from recorded milestones, each labelled with what it is based on:

| Event | Basis |
|---|---|
| Published, added to sitemap | the site's own record |
| Google lists the URL in a sitemap, Google knows the URL, reported indexed | **observed** — the first check that showed it (Google reports no date for these) |
| Google crawled | Google's own `lastCrawlTime` (the earliest seen; the true first crawl may be earlier) |
| First impression | Search Analytics date |
| Status changes | observed |

Across all URLs the engine computes **typical timings** (median days from publication to Google knowing the URL, crawl,
indexed and first impression — only URLs with both ends count). Resolution is the check interval, so these are
approximations: "new tools are typically crawled in about 2 days and indexed in about 5".

## Alerts

Derived with configurable thresholds so a page just published raises nothing: `NEW_INDEXING_PROBLEM` (was indexed, no longer),
`NEW_PAGE_NOT_DISCOVERED` (in the sitemap, published N days ago, Google has no record), `NOT_INDEXED_PERSISTS`,
`CANONICAL_CONFLICT`, `BLOCKED`, and site-level `STAGING_INDEXABLE`, `GOOGLE_STATUS_UNAVAILABLE`, `SITEMAP_ERRORS`. An alert is
opened once and resolves itself when the condition clears.

Defaults (override in `analytics.searchConsole.indexMonitor.thresholds` / the adapter config): `newPageGraceDays` 3,
`notDiscoveredAlertDays` 7, `notIndexedAlertDays` 14, `indexedNoImpressionsNoteDays` 28, `batchSize` 20,
`dailyInspectionCap` 400, `manualUrlCooldownMinutes` 30, `manualRefreshCooldownMinutes` 15.

## Staging

Only production URLs are ever sent to Google (guarded in `runMonitor`, in `normalizeUrl` and in the client). The monitor
checks that staging stays hidden — `PROTECTED` (noindex by header or meta tag), `PARTIAL` (robots.txt only; a blocked URL can
still be listed), `EXPOSED`, or `UNKNOWN` (never treated as protected) — and raises `STAGING_INDEXABLE` if it is not. It
makes no indexing request for staging, ever.

## Google indexing requests

Not automated and never retried in a loop. Manual **Request Indexing** remains an optional, one-off owner action. Google's
**Indexing API** is only for `JobPosting` / `BroadcastEvent` content and is **not** used for ordinary pages. Discovery relies
on crawlable architecture, internal links, the XML sitemap, correct canonicals and useful content.

## Authentication

A **service account** (a supported Search Console API mechanism): Search Console API enabled in a Google Cloud project, a
service-account key stored **only** as a host secret named by `analytics.searchConsole.credentialsSource`
(`env:BWESEO_GSC_SERVICE_ACCOUNT_JSON`), and the service account's email added as a user of the Search Console property.
Scopes: `webmasters.readonly` (inspection, analytics, sitemap reads) and `webmasters` (only for an explicit SUBMIT SITEMAP).
The key is read inside the client closure and is never logged, returned, stored in the project or sent to a browser;
`redact()` strips credential-shaped text from every message.

## Failure handling

| Condition | Result |
|---|---|
| Not configured / credential missing | pages are still discovered; Search Console shows **Not connected**; nothing is guessed |
| `401/403`, sign-in rejected | run stops at the first call; Search Console **Not connected — permission-denied / auth-failed** |
| URL not under the property, `404` | recorded as an error for that URL |
| Quota / `429` | Google calls paused until midnight UTC |
| Timeout (20 s) / network / malformed response | per-URL "temporarily unavailable"; earlier state kept; three failures stop the run |
| Many consecutive failures | one site-level alert: *Google status is temporarily unavailable* |

## `/BWESEO` integration

`/BWESEO` reads `seo/data/google-index/snapshot.json` (pulled with `node seo/tools/seo-google-index.mjs pull`, which uses the
developer's own `wrangler` login against the production KV namespace named in config — no secret). It shows Search Console,
Sitemap, Indexing and the indexing rate (a plain ratio, **never a score**), and recommends: connect Search Console · submit the
sitemap · repair sitemap generation · investigate not-indexed URLs (listing Google's own evidence) · review indexed pages with no
impressions · refresh a stale snapshot. These are diagnostic recommendations, not guarantees about Google's ranking behaviour.

## Not on Cloudflare?

The monitor core has no Cloudflare dependency: it needs a `store` ({get, put, delete} - a database table, a file, Redis), a scheduler
(cron, a queue, a GitHub Action) and the site's `discover()`. Only the optional `kvStore` helper and the `cloudflare-kv` snapshot
source are Cloudflare-specific. For any other host set `snapshot.source` to `file` and `snapshot.dir`: the site's job writes
`summary.json` (the `gi:summary` document) and `registry.json` there, and `pull` copies them.

## Configuration (`seo/seo-config.json`)

```json
"analytics": { "searchConsole": {
  "enabled": true,
  "credentialsSource": "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON",
  "indexMonitor": {
    "enabled": true,
    "staleAfterDays": 3,
    "thresholds": { "batchSize": 12 },
    "snapshot": { "source": "cloudflare-kv", "kvNamespaceId": "<production KV namespace id>" }
  }
} }
```

## Installing on another website

1. `/BWESEOInstall` copies the generic modules into `seo/tools/` (no site data).
2. Add the `indexMonitor` block above for **this** site, with its own property, sitemap and KV namespace.
3. Write the site adapter (discover, store, optional fetchHtml/fetchStaging), a scheduled handler that calls `runMonitor`, and
   admin endpoints that call it with `mode: "refresh" | "url"`. The first implementation (a Cloudflare Workers + KV site) is the reference; its adapter lives in that site, never in the engine.
4. Create the Google service account and add it to **this** site's Search Console property; store the key as a secret.
5. Run the site's tests with a mocked Google client; **tests never call Google**.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| *Not connected — permission-denied* | the service account's email was not added to the Search Console property (or has restricted access) |
| *Not connected — auth-failed* | the key is revoked, malformed, or the Search Console API is not enabled in the key's Google Cloud project |
| Everything `NOT_CHECKED` | the scheduled trigger has not run yet; use REFRESH GOOGLE STATUS |
| *Quota* | the daily allowance was reached; it resets at midnight UTC |
| `UNKNOWN` states | Google used coverage wording not mapped yet; the original text is shown |
| `/BWESEO` says "no monitoring data" | run `seo-google-index.mjs pull` (needs a `wrangler` login) |
