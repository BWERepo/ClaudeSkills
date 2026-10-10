# Content refresh (`/BWESEORefresh`)

Published content must stay true and useful. Review every published page at least every 6 months
(sooner for pricing/service pages) using `lastReviewed` in the inventory.

## Triggers

- Profile fact changed (price, service, hours, staff, area) → every page using that fact.
- Page `lastReviewed` older than 180 days.
- Search Console: weak CTR, declining impressions/clicks, positions 5–20 (`search-console.md`).
- Traffic without conversions.
- Broken links, outdated images/screenshots, technical regressions.
- Search intent changed (SERP now shows a different page type).
- Missing internal links from newer pages.

## Procedure

1. List candidate pages with the trigger and evidence.
2. For each, re-run the claims ledger against the current profile; anything stale → fix or remove.
3. Decide: minor refresh (facts/links/title) · substantive update (sections) · merge · retire
   (301 to the best alternative).
4. Changes to live pages follow the normal approval → change → QA → deploy workflow.
5. Update `lastReviewed` (and `status` → `update-needed` for pages awaiting work).

## Output

Refresh queue table: page · trigger · evidence · recommended action · effort · priority.

## New pages

A page published in the last 90 days is reviewed on its 7/30/90-day schedule (`search-console.md`),
not rewritten early. **Don't rewrite a page just because it hasn't ranked quickly** — first check
it is indexed, linked and matched to the right intent. The 90-day review is where expand / revise /
consolidate / leave-alone is decided.
