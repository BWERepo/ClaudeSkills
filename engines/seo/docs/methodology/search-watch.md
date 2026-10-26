# Search watch: the Google search monitoring workflow

One customer-local workflow, run from the website project with `node seo/tools/seo-watch.mjs`. It adds no crawler and no new Google integration: it
reuses the engine's redirect-aware fetch (`seo-site-checks.fetchChain`), head parser (`post-publish-check.extractHead`), the Search Console client
(`gsc-client.mjs`, URL Inspection and Search Analytics), the index-monitor's state rules (`index-monitor.mjs`), the comparable-period and low-sample rules
of `outcome-history.mjs`, the atomic writer (`safe-write.mjs`) and the unified improvement queue. Rules: `src/search-watch.mjs` (pure); CLI: `src/seo-watch.mjs`.

## On by default, with an off switch
Installing the engine turns the workflow on. The configuration block `analytics.searchConsole.searchWatch` is optional; when it is absent, or
`enabled` is not `false`, the workflow is on. `seo-watch.mjs disable --by "<name>"` writes `enabled: false` (and who and when) to `seo/seo-config.json`;
`enable` reverses it. While off, every command except `status`, `findings`, `enable` and `disable` refuses, and `notify` records nothing and exits 0
so a website's publish step never fails because of it. The improvement queue ignores the findings while it is off. Existing data is never deleted.
"On" does not start anything by itself: the engine never schedules a job on the website's host or contacts Google at install time. The owner (or the
website's scheduler) runs `sync`, `daily` and `weekly`.

## 1. Keeping the sitemap current
The website's publish step calls `seo-watch.mjs notify <url|path> --event published|changed|removed [--lastmod ISO-date] [--canonical <url>] [--noindex]`
for each page it publishes, changes or removes. That hook is customer-site work (see "Customer-site validation" in the change's report); the engine
only defines the contract. Each call writes one file to `seo/data/search-watch/inbox/`. `seo-watch.mjs sync` applies the inbox to the page ledger
(`ledger.json`) and rewrites the sitemap (`sitemapPath`, default `public/sitemap.xml`; refused outside the project).
- Only production-origin pages are accepted; an off-origin URL, an unknown event or a bad `lastmod` is rejected with the reason and does not stop the others.
- A page is in the sitemap only if it is live, not `noindex`, and its canonical is itself. A page whose latest daily crawl was 404 or 410 is left out;
  a 5xx or a network error is not a reason to drop a page. `lastmod` is written only when the site supplied it; it is never invented.
- The file is written atomically (temp file and rename) and only when its bytes change. Above 50,000 URLs it becomes an index plus parts.
- **Shrink guard:** a regeneration that would drop more than `maxShrinkPercent` (default 20) of the URLs in the existing file is refused, nothing is
  written and the inbox is left for retry. Load the current sitemap once with `seed --sitemap <file>` before the first sync; use `--allow-shrink` only when the pages really are gone.
- Inbox files are moved to `inbox/processed/` only after the sitemap and the ledger are written, so a crash is safe: re-running re-applies the events
  (idempotent). An unreadable file is moved to `inbox/rejected/` and does not block later syncs.
- `sync` does not contact Google. Google reads the sitemap on its own; to check or register it use `seo-google.mjs sitemap` (a dry run first).

## 2. The daily check
`daily` checks (a) pages never checked before, oldest first, at most `newPerRun` (default 25; the rest wait and are reported as a backlog), then (b) a rotating
sample of the other live pages, `sampleSize` per run (default 10). The rotation remembers the last path checked, not a position, so pages added or removed
between runs are never skipped or repeated; it wraps at the end. Per page it makes one read-only GET of the production URL (redirects recorded hop by hop) and,
when Search Console is available, one URL Inspection call. Quotas: inspections are capped at `dailyInspectionCap` per UTC day (default 40, a limit the
workflow sets for itself, below Google's); the day's targets are cut to fit and the run reports `partial`. A fatal Search Console error (permission, auth,
quota) or three failures in a row stops inspecting; the pages not reached keep their place and come first next run. Staging URLs are never sent anywhere.

## 3. What is flagged, and on what evidence
| Finding | Evidence it needs |
|---|---|
| `not-indexed` | **Search Console URL Inspection only.** Never inferred from a crawl, a 200 response or the sitemap. A page younger than `graceDays` (default 3) is listed as waiting, not flagged. A state the engine cannot classify is not flagged. Without Search Console access the run says indexing was not checked. |
| `crawl-failure` | The daily crawl: 4xx, a redirect, a redirect loop, a bad redirect are flagged at once; 5xx and network errors only after `confirmAfter` consecutive failed checks (default 2), and listed as unconfirmed before that. |
| `unexpected-canonical` | The page declares a canonical other than itself (or other than the one recorded by a `changed` event), **or** Google chose a different canonical than the page declares (URL Inspection). The two are separate evidence and say so. |
| `missing-canonical` | The crawl found no canonical tag (low severity). |
Findings are derived from the stored evidence each run, so fixing a page clears its finding at its next check. They are saved in `findings.json` and read by
`seo-queue.mjs build` as the `search-watch` source: an item is resolved only by a complete run, for a page with newer evidence that no longer reports it.

## 4. The weekly report
`weekly` compares the last 7 complete days with the 7 days before them (the newest 2 days are left out: Search Console is final about 2 days late). Rows come
from `--rows rows.json` (`[{ date, page, clicks, impressions, position? }]`) or the Search Console API. Search Console omits a page on a day it had no impressions, so a page with no row on a day that other pages reported counts as 0 for that day; a day that no page reported is missing, and a metric with a missing day is "unavailable", never a
partial sum or a zero; volumes below the `seo-outcomes` limits (100 impressions, 30 clicks) are flagged low-sample and never drive a recommendation. Pages
changed in the two weeks (from `seo/data/outcomes.json`) are listed as context. Every report says it compares two periods and does not show a cause.
**The three fixes** are findings grouped by type and ranked by severity, number of pages, clicks lost on those pages and impressions; a click drop on a page
with no finding is offered only as a low-confidence lead ("cause unknown"). If the evidence supports fewer than three, fewer are listed and the report says
so; nothing is padded. Reports are written to `seo/data/search-watch/reports/weekly-<date>.md` and `.json`.

## Data and limits
Everything is in `seo/data/search-watch/` (git-ignored customer data): `ledger.json`, `state.json` (cursor, quota, per-page evidence, run log), `findings.json`,
`inbox/`, `reports/`. Schemas are versioned (`watchSchemaVersion: 1`; a newer file is refused untouched). Not verified by the engine's tests: anything against a live
site or live Google; those steps are listed with each change under "customer-site validation".
