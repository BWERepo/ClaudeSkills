---
name: BWESEOCompetitors
description: Search-results and competitor gap analysis for approved target topics in the current website project using the BWESEO engine — who ranks, which page types win, questions answered, depth, local relevance, pricing/proof patterns and gaps this business can honestly fill. Uses standard web search only; never copies competitor content, never invents volumes. Use when the user says "competitor analysis", "check the SERP", "who ranks for", or invokes /BWESEOCompetitors, in any website project.
---

> `$BWESEO_ENGINE` = the canonical BWESEO engine directory: `$BWESEO_ENGINE_HOME` if set, else the `path` in
> `~/.claude/bweseo/engine-location.json` (see `/BWESEOInstall`). Engine code lives in `$BWESEO_ENGINE/src`, methodology in
> `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`.

# BWESEOCompetitors

1. Project guard (`/BWESEO` Step 0).
2. Topics: the ones the user names, else the current P1/P2 inventory entries. Keep it light —
   a handful of standard-mode web searches (head query + 1–2 variants per topic). If web search
   isn't available, say so and stop.
3. Follow `$BWESEO_ENGINE/docs/methodology/competitor-research.md`. Record findings in
   your own words; cite result URLs as sources; never paste competitor text.
4. Update each topic's `SERP notes` in `docs/seo/SEO-PAGE-MAP.md` and the Competitive landscape
   section of `docs/seo/SEO-STRATEGY.md`. Research-found competitors go into the profile's
   `competitors[]` as `unverified` with `source: "research:<date>"`.
5. If the SERP shows a topic can't be realistically won (directories/national brands only),
   downgrade its priority and say why.
