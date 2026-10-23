---
name: BWE-SEO-LOCAL
description: Local SEO analysis for the current website project using the BWE-SEO engine — NAP consistency, address type (storefront vs service-area vs mailing), service-area honesty, location pages (keep/improve/merge/retire, doorway-page risk), and Google Business Profile builder (eligibility, duplicate check, draft, verification help) in manual mode. Only for location-dependent businesses. Use when the user says "local SEO", "location pages", "Google Business Profile", or invokes /BWE-SEO-LOCAL, in any website project.
---

> `$BWESEO_ENGINE` = the BWE-SEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWE-SEO-LOCAL

1. Project guard (`/BWE-SEO` Step 0).
   When the argument is an inventory `issues[]` id (that's how `/BWE-SEO` routes a site issue), scope
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
6. Record state (`docs/methodology/workflow-state.md`): add new findings to the inventory's `issues[]` (see `/BWE-SEO-AUDIT` step 4);
   when a fix is made set `status: "fixed"` + `fixedOn`, and `"verified"` + `verifiedOn` once
   production shows it.

## GBP mode — `/BWE-SEO-LOCAL gbp`
Manual mode, no Google access needed. Follow `$BWESEO_ENGINE/docs/methodology/google-business-profile.md` and drive
`node seo/tools/seo-local-gbp.mjs` (`status`, `questions`, `eligibility`, `discover`, `draft`, `check`, `schema`, `audit`, `approve`, `created`, `verification`, `recommend`, `queue`, `reviews`, `review-request`, `posts`, `performance`).
- Recommendations go into the shared improvement queue with `queue --sync`; reviews, posts and performance figures are manual imports,
  labelled as such. Replies and posts need a named approver and are posted by the owner, never by the engine. Review requests are
  neutral (no rewards, no gating). Never invent figures, rankings or reviews.
- Ask the eligibility questions of the administrator; never infer them from marketing copy. Online-only, PO box or virtual-office businesses
  get website-SEO alternatives, never a profile.
- Search for existing profiles first (official Google interface only; no scraping). Resolve every likely duplicate before creation.
- Build the draft only from verified facts; never invent services, categories, hours, photos or credentials.
- Show **USER INPUT NEEDED** wherever the owner must act in Google's interface. Record manual steps as owner-reported; never say Google
  verified or published anything, and never promise a verification method.
- API features (OAuth, sync, reviews, posts, performance) are not available until Google grants API access; say so.
