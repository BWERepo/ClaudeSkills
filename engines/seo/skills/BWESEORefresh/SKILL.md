---
name: BWESEORefresh
description: Finds published pages in the current website project that need updating using the BWESEO engine — stale facts or prices versus the business profile, old lastReviewed dates, weak CTR or declining Search Console numbers, broken links, missing internal links, outdated images, changed search intent, traffic without conversions — and produces a prioritized refresh queue. Use when the user says "refresh content", "what pages are outdated", "content review", or invokes /BWESEORefresh, in any website project.
---

> `$BWESEO_ENGINE` = the canonical BWESEO engine directory: `$BWESEO_ENGINE_HOME` if set, else the `path` in
> `~/.claude/bweseo/engine-location.json` (see `/BWESEOInstall`). Engine code lives in `$BWESEO_ENGINE/src`, methodology in
> `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`.

# BWESEORefresh

1. Project guard (`/BWESEO` Step 0).
2. Follow `$BWESEO_ENGINE/docs/methodology/content-refresh.md`: check every published
   inventory entry's `lastReviewed`, re-run its claims against the current profile (and the live
   source for prices/facts), check links, and use Search Console exports if present.
3. Output the refresh queue (page · trigger · evidence · action · effort · priority) into
   `docs/seo/reports/refresh-<YYYY-MM-DD>.md`; set `status: "update-needed"` on affected
   entries with `refresh: { trigger, evidence, flaggedOn, source }`. When an improvement goes
   live, set `lastRefreshedOn` and `refresh.resolvedOn`.
4. Edits to live pages only after approval, one page at a time, via `/BWESEOCreatePage`-style
   steps (claims ledger → QA).

Pages published in the last 90 days follow their 7/30/90-day schedule — don't queue a rewrite just
because a new page hasn't ranked yet (`docs/methodology/content-refresh.md` → New pages).
