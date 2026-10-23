---
name: BWE-SEO-REPORT
description: Generates a plain-language SEO progress/performance report for the current website project using the BWE-SEO engine — what shipped, Search Console summary (from owner exports), organic conversions against the business's primary success metric (qualified leads, appointments, sales, prototype requests), pages needing refresh, and next month's plan, with honest data caveats. Use when the user says "SEO report", "monthly SEO report", "how is SEO doing", or invokes /BWE-SEO-REPORT, in any website project.
---

> `$BWESEO_ENGINE` = the BWE-SEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWE-SEO-REPORT

1. Project guard (`/BWE-SEO` Step 0).
2. Follow `$BWESEO_ENGINE/docs/methodology/measurement-reporting.md`, using the
   definitions in `docs/seo/SEO-MEASUREMENT.md` (primary metric, baseline, sources).
3. Sources: `node seo/tools/seo-state.mjs --details --offline` (current state and page
   histories), inventory history (what shipped), `seo/data/` exports, conversion records the
   project can read (read-only), `docs/seo/reports/` from previous periods.
4. Write `docs/seo/reports/<YYYY-MM>.md`. Say "not measured" where data doesn't exist; never
   estimate numbers. Lead with customers/conversions, not rankings.

Include a "New pages" section: each page published in the period with its publication date, the
post-publication result, Search Console indexing-request status (REQUESTED / NOT REQUESTED /
UNKNOWN — verified information only) and which 7/30/90-day reviews are due.
