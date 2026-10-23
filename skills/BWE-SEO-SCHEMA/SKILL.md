---
name: BWE-SEO-SCHEMA
description: Structured-data (JSON-LD / schema.org) audit for the current website project using the BWE-SEO engine — lists every schema block per page, where its values come from, conflicts and duplicates, unsupported or fabricated properties (ratings, reviews, hours, sameAs), and recommends only schema the visible page and verified business facts support. Use when the user says "check schema", "structured data audit", "JSON-LD", or invokes /BWE-SEO-SCHEMA, in any website project.
---

> `$BWESEO_ENGINE` = the BWE-SEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWE-SEO-SCHEMA

1. Project guard (`/BWE-SEO` Step 0).
   When the argument is an inventory `issues[]` id (that's how `/BWE-SEO` routes a site issue), scope
   the run to that issue: re-check it, propose the fix, and record the outcome on that entry.
2. Follow `$BWESEO_ENGINE/docs/methodology/structured-data.md`: inventory every JSON-LD
   block (types, properties, data source: hard-coded vs. data-driven), check JSON validity,
   duplicates/conflicting entity descriptions, missing `@id` linking, empty structures, and any
   property not supported by visible content or a `verified` profile fact.
3. Flag immediately (Critical) any Review/AggregateRating not backed by real on-page reviews.
4. Recommend changes per page, reusing the project's existing schema helper functions.
5. Write results to `docs/seo/SEO-BASELINE.md` → Structured data (or the page's QA report when
   scoped to one page). Change nothing without approval. Suggest the user validate changed
   pages in Google's Rich Results Test.
6. Record state (`docs/methodology/workflow-state.md`): add new findings to the inventory's `issues[]` (see `/BWE-SEO-AUDIT` step 4);
   when a fix is made set `status: "fixed"` + `fixedOn`, and `"verified"` + `verifiedOn` once
   production shows it.
