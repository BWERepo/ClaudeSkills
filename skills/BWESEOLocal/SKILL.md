---
name: BWESEOLocal
description: Local SEO analysis for the current website project using the BWESEO engine — NAP consistency, address type (storefront vs service-area vs mailing), service-area honesty, location pages (keep/improve/merge/retire, doorway-page risk), and Google Business Profile actions for the owner. Only for location-dependent businesses. Use when the user says "local SEO", "location pages", "Google Business Profile", or invokes /BWESEOLocal, in any website project.
---

> `$BWESEO_ENGINE` = the BWESEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWESEOLocal

1. Project guard (`/BWESEO` Step 0).
   When the argument is an inventory `issues[]` id (that's how `/BWESEO` routes a site issue), scope
   the run to that issue: re-check it, propose the fix, and record the outcome on that entry.
2. Read `markets.locationDependence` from `seo/business-profile.json`. If `non-local`, say local
   SEO doesn't apply and stop (unless the user insists — then explain the risk).
3. Follow `$BWESEO_ENGINE/docs/methodology/local-seo.md`: NAP everywhere (site, schema,
   footer), address type and whether it's public, service-area wording, each location page's
   unique value (quote what's genuinely different), office/presence claims.
4. Ask the user about Google Business Profile status (the engine can't see it); give GBP
   recommendations as a checklist for the owner.
5. Write findings into `docs/seo/SEO-BASELINE.md` → Local and location-page decisions into
   `docs/seo/SEO-PAGE-MAP.md`. Never create city pages here.
6. Record state (`docs/methodology/workflow-state.md`): add new findings to the inventory's `issues[]` (see `/BWESEOAudit` step 4);
   when a fix is made set `status: "fixed"` + `fixedOn`, and `"verified"` + `verifiedOn` once
   production shows it.
