---
name: BWE-SEO-CONTENT-PLAN
description: Creates or updates the SEO page map, pillar/cluster architecture and prioritized content roadmap (about 10-20 opportunities, quality over quantity) for the current website project using the BWE-SEO engine, then presents the top ~5 P1 pages in an approval report and STOPS — it never creates pages. Use when the user says "content plan", "SEO roadmap", "page map", "which pages first", or invokes /BWE-SEO-CONTENT-PLAN, in any website project.
---

> `$BWESEO_ENGINE` = the BWE-SEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWE-SEO-CONTENT-PLAN

1. Project guard (`/BWE-SEO` Step 0). Needs scored opportunities (run `/BWE-SEO-OPPORTUNITIES`
   first if the inventory has none).
2. Follow `$BWESEO_ENGINE/docs/methodology/page-map-and-roadmap.md`:
   - pillars/clusters appropriate to the industry guide;
   - `docs/seo/SEO-PAGE-MAP.md` — one card per page with every field;
   - `docs/seo/CONTENT-ROADMAP.md` — each item answers the five questions; weak answers → move
     to Rejected/parked; include "existing pages to improve" and blocking facts/fixes;
   - `docs/seo/INTERNAL-LINKING.md` → planned links for each roadmap page.
3. Update inventory entries (`idea` / `planned` for the P1 set). Record state (`docs/methodology/workflow-state.md`): set
   `roadmapOrder` to each item's position in CONTENT-ROADMAP.md (entries that are ONE roadmap item
   — e.g. a page plus a retitle elsewhere — share the number and are approved together), a short
   `name`, and `blockedBy` for anything waiting on a fact. Run the validator and the project's
   tests.
4. Present the **P1 approval report** (page · URL · intent · prospective customer · why it
   should exist · conflicting existing page · conversion path · links to it · links from it ·
   unique value).
5. **STOP.** Ask the user which ONE page to create first. When they approve, set that entry to
   `approved` with `approvedOn` (today) and `approvedBy: "user"` — every entry of that roadmap
   item, nothing else. An improvement to an existing page becomes `approved` too;
   `/BWE-SEO-CREATE-PAGE` then edits it in place (same URL).
