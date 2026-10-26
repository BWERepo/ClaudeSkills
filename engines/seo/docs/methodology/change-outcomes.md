# Change-to-outcome history

Each customer records page changes and later compares search and conversion figures in its own data (`seo/data/outcomes.json`).
Code: `src/outcome-history.mjs`, CLI `src/seo-outcomes.mjs`.

**A record** holds the page (or `*` for a site-wide change), change category, publication time, the page's content hash (`--hash`, or `--inventory-id` to take it from the page source) and any release hash, the baseline period, review dates (default 14, 28 and 56 days after publication) and who recorded it. Changes are append-only.

**A comparison** uses two equal-length periods (default 28 days) immediately before and after the publication day; the publication day is excluded. Figures come from saved daily rows you supply; the engine makes no request. The after period must be complete and past the Search Console lag (default 2 days), otherwise the status is `pending`.

Flags raised: `missing-data` (a metric is not compared unless every day in both periods has a value), `low-sample` (impressions or clicks under the configured minimums), `seasonality-not-controlled` (no complete data for the same periods a year earlier; when present a rough year-ago reference is shown), `overlapping-changes` (another change to the same page or a site-wide change inside either period), `date-only`.

- Zero and unavailable differ: a day with a reported 0 counts as data; a missing field is unavailable and the metric reports why.
- Position is the Search Console impression-weighted average for the page, labelled as such. It is not a live ranking.
- Indexing is never inferred from traffic. An indexing record can be passed through; otherwise it reads "not provided".
- Every result says `interpretation: "association"`. A difference between periods is not proof that the change caused it.

Thresholds (`windowDays`, `lagDays`, `minImpressions`, `minClicks`, `reviewAfterDays`) can be overridden in `analytics.searchConsole.outcomeHistory` in `seo-config.json`. `outcomesSchemaVersion: 1`; an unversioned file is upgraded in memory and a newer one is refused.
