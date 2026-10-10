---
name: BWESEOInternalLinks
description: Internal-link analysis for the current website project using the BWESEO engine — builds the link graph from nav, footer and body links, finds orphan pages, broken or page-specific anchors, weak pillar/cluster linking and repetitive exact-match anchors, and plans natural links to and from each roadmap page. Use when the user says "internal links", "orphan pages", "link structure", or invokes /BWESEOInternalLinks, in any website project.
---

> `$BWESEO_ENGINE` = the canonical BWESEO engine directory: `$BWESEO_ENGINE_HOME` if set, else the `path` in
> `~/.claude/bweseo/engine-location.json` (see `/BWESEOInstall`). Engine code lives in `$BWESEO_ENGINE/src`, methodology in
> `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`.

# BWESEOInternalLinks

1. Project guard (`/BWESEO` Step 0).
   When the argument is an inventory `issues[]` id (that's how `/BWESEO` routes a site issue), scope
   the run to that issue: re-check it, propose the fix, and record the outcome on that entry.
2. Follow `$BWESEO_ENGINE/docs/methodology/internal-linking.md`. Build the graph from
   source (route/components/content data), not guesses; check shared components (nav/footer) on
   every page they render.
3. Write `docs/seo/INTERNAL-LINKING.md`: link matrix, issues (with file:line), rules, and the
   planned in/out links for every roadmap page. Update `relatedPages`/`parent` in the inventory.
4. Change no site code unless the user approves specific link fixes.
5. Record state (`docs/methodology/workflow-state.md`): add new findings to the inventory's `issues[]` (see `/BWESEOAudit` step 4);
   when a fix is made set `status: "fixed"` + `fixedOn`, and `"verified"` + `verifiedOn` once
   production shows it.
