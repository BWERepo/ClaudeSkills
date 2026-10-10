# Search Console analysis (`/BWESEOSearchConsole`)

> **PUBLISHED does not mean DISCOVERED. DISCOVERED does not mean CRAWLED. CRAWLED does not mean INDEXED.
> INDEXED does not mean RANKING WELL. RANKING / TRAFFIC does not necessarily mean BUSINESS CONVERSIONS.**
> The objective is measurable customer acquisition, not vanity SEO metrics.

## Google discovery, crawling and indexing (engine 1.7.0)

After a page reaches production the Google workflow is a chain of SEPARATE facts, each recorded with its own date
and source. None implies the next; an unproven stage is `UNKNOWN`/`PENDING`, never assumed.

| Stage | Level | Evidence that completes it |
|---|---|---|
| Google readiness | page | The post-publication check on the production URL (`postPublication.google.readiness`, `PASSED` = technically ready — nothing more) |
| Sitemap includes the page | page | The production sitemap lists the canonical URL (`postPublication.google.sitemap`) |
| Search Console property | **site** | The owner confirms it is verified (`analytics.searchConsole.configured`; never a token) |
| Sitemap registered | **site** | Search Console reports the sitemap (API `sitemaps.get`, or the owner reads the Sitemaps page) — a page count is site-wide, not proof for one URL |
| Google discovered | page | URL Inspection coverage state ("Discovered – currently not indexed", or better) + date + source |
| Google crawled | page | URL Inspection `lastCrawlTime` / "Crawled – currently not indexed" + date + source |
| Google indexed | page | URL Inspection says the URL is on Google (`indexed: INDEXED` + evidence + source) — nothing else |
| Monitoring | page | Starts once indexed; performance + 7/30/90-day reviews |

**Not evidence of indexing:** HTTP 200, publication, sitemap inclusion / submission / "Success", a passed Live URL Test,
Property verification, Googlebot access, being discovered, being crawled, a Request Indexing click.

**Automation, by what Google actually offers** (all optional; enabled per project with `analytics.searchConsole.enabled` +
`credentialsSource` — a NAME, never the credential):

- **Sitemap registration** — official Search Console API (`sitemaps.get` / `sitemaps.submit`), idempotent: an already
  registered sitemap is reported ("Sitemap already registered with Google Search Console."), never resubmitted; resubmit
  only when missing, when Google reports errors, or when forced.
- **Discovery / crawl / index evidence** — official URL Inspection API (read-only), interpreted stage by stage.
- **Performance** — official Search Analytics API (read-only): impressions, clicks, CTR, position, queries; conversions only
  where analytics provides them. **Zero data is valid** ("No Search Console performance data yet") — never an error, never
  estimated.
- **Not automated, by design:** "Request Indexing" (a manual, *optional* accelerator recorded once, never repeated or
  required) and Google's **Indexing API**, which is only for `JobPosting` / `BroadcastEvent` content and must never be used
  for ordinary SEO pages (`indexingApiEligible: false` by default; a future qualified content type needs an explicit adapter).
- Staging, preview and local URLs are never submitted, inspected or queried. A health failure (5xx / 522 / timeout) never
  changes any of this history and never triggers a sitemap resubmission.

Without the API everything that does not need it still runs; the remaining step is named exactly (usually: confirm the
sitemap once, and at a review date read URL Inspection and report what it says).

Never request, store or hard-code credentials. Use data only when legitimately available:
the owner exports it (Performance report → Export → CSV/Sheets) into
`seo/data/search-console/<YYYY-MM-DD>/` (gitignored), or an already-authorized connector exists.
Never fabricate or extrapolate data.

## Inputs

Queries.csv, Pages.csv (and optionally Countries/Devices/Dates) for a stated date range; ideally
two ranges (last 28 days vs. previous 28, or last 3 months vs. previous 3).

## Patterns to look for

| Pattern | Likely action |
|---|---|
| High impressions + low CTR | Rewrite title/description to match intent; check SERP features stealing clicks |
| Query with impressions but no strong matching page | Evaluate a page opportunity (run cannibalization first) |
| Average position ≈ 5–20 | Improve the existing page: depth, internal links, intent match |
| Declining clicks/impressions on a page | Investigate: technical change, intent shift, competitor, seasonality |
| Traffic without conversions | Review conversion path on that landing page |
| Brand queries only | Non-brand visibility is the gap — roadmap P1s matter |
| Impressions for services the business doesn't offer | Do NOT chase them; check `doNotPromote`, consider clarifying copy |

## Output

`docs/seo/reports/search-console-<date>.md`: date ranges, totals, top queries/pages, the
patterns above with specific URLs, recommended actions (each routed to refresh, create, or
technical), and what data was missing.

## Per-page reviews after publication (7 / 30 / 90 days)

`/BWESEOPublish` records each new page's publication date and review dates
(`postPublication.monitoring`). At each checkpoint, with the owner's latest export:

- **7 days** — URL Inspection result if the owner ran it (discovered? crawled? indexed? any
  "Excluded" reason?), technical problems, obvious Search Console issues.
- **30 days** — impressions, queries, clicks, CTR, average-position trend for the page; is the
  intent right (are the queries the ones the page was built for)?; internal-link opportunities.
- **90 days** — the real review: which queries produce impressions, ranking and traffic trends,
  conversions, content gaps, weak sections, title/description opportunities, cannibalization with
  other pages, internal links — then recommend expand / revise / consolidate / leave alone (via
  `/BWESEORefresh`).

Report only what the data shows; early checkpoints often have little or no data — say so. Never
recommend rewriting a page just because it hasn't ranked quickly. Record each review in
`docs/seo/reports/` and set the inventory `nextReview` to the next checkpoint.

## Keywords and target pages (engine 1.10.0)

Matching Search Console queries to the page each is meant to rank for, wrong-page and cannibalization detection from real impression data, discovered queries and
evidence-based recommendations are in `keyword-performance.md`. Search Analytics (query × page) is the same data used here; the keyword system adds the registry and the rules.
