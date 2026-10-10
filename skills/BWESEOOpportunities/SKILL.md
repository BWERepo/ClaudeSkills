---
name: BWESEOOpportunities
description: Identifies SEO customer-acquisition opportunities for the current website project using the BWESEO engine — maps searches that could bring a QUALIFIED customer to verified offerings, classifies intent (commercial, service, local, comparison, problem/solution, informational), scores them P1/P2/P3 without invented keyword volumes, and runs the cannibalization check (create / improve-existing / merge / reject) on each. Use when the user says "SEO opportunities", "what pages should we add", "keyword ideas", or invokes /BWESEOOpportunities, in any website project.
---

> `$BWESEO_ENGINE` = the BWESEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWESEOOpportunities

1. Project guard (`/BWESEO` Step 0). A current `docs/seo/SEO-BASELINE.md` should exist — if not,
   suggest `/BWESEOAudit` first (or do a light inventory pass).
2. Generate candidate query clusters from: verified offerings (priority/high-value first), the
   industry guide (`docs/industries/<x>.md`), customer problems in the profile, Search Console
   data in `seo/data/` (if any), and research seeds the user supplied. Never from services the
   business doesn't verifiably offer; skip `doNotPromote` topics.
3. Classify each with `docs/methodology/intent-model.md`.
4. Run `docs/methodology/cannibalization.md` against the inventory AND the live source.
5. Score with `docs/methodology/opportunity-scoring.md` (H/M/L per factor with evidence; P1/P2/
   P3/reject). No volumes or difficulty numbers unless real data exists.
6. Add/refresh inventory entries (`idea`, with priority, intent, parent, CTA, cannibalization,
   a short `name`, `proposedOn`). Record state (`docs/methodology/workflow-state.md`): if an idea needs a fact the profile doesn't verify,
   add an `openQuestions` entry (with `blocks: [<id>]`) and put its id in the page's `blockedBy`.
   Record rejects too (status `rejected`, reason in notes) so they aren't re-proposed.
7. Output the scored table and hand off to `/BWESEOContentPlan`. Create no pages.
