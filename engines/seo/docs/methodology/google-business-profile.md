# Google Business Profile builder and Local SEO engine (`/BWESEOLocal gbp`)

Reusable module inside BWESEO. **Phase 1 — manual mode** (this document). Later phases (Google OAuth and API sync, optimization, monitoring) are
listed under "Not built yet"; none of them is claimed here.

The module is customer-neutral. Each client website has its own `seo/` folder, so Business Web Express managing several clients means one
isolated `seo/data/local-gbp/` per project: no state, credential or business fact is ever shared between clients.

## What manual mode does (no Google access needed)

| Step | Command (`node seo/tools/seo-local-gbp.mjs …`) | Result |
|---|---|---|
| Ask the eligibility questions | `questions` | The questions for the administrator. Eligibility is never inferred from marketing copy. |
| Assess eligibility | `eligibility --answers a.json --by "<name>"` | storefront / service-area / hybrid / online-only; blockers; warnings; USER INPUT NEEDED. |
| Find existing profiles | `discover --method "<where>" --by "<name>" [--candidates c.json]` | Records the search and compares candidates by name, phone, website and address. |
| Resolve a possible duplicate | `discover --resolve <key> --resolution claim --reason "<why>" --by "<name>"` | A likely duplicate blocks creation until resolved with a reason and a name. |
| Build the draft | `draft --init` | Draft from **verified, public** facts in `seo/business-profile.json`; description generated only from those facts. |
| Check readiness | `check` | Validation, readiness preview, completeness checklist, USER INPUT NEEDED. |
| LocalBusiness JSON-LD | `schema` | Most specific supported subtype; verified facts only; hidden addresses never emitted; no invented ratings. |
| Website consistency | `audit --html page.html` | Name, phone, address, hours, duplicate/contradictory structured data, hidden-address leaks. |
| Approve | `approve --by "<name>"` | Records approver and time for the exact draft; any later edit voids it. |
| Report creation | `created --by "<name>"` | Only after the gate is open. Recorded as *reported by the administrator*. |
| Verification | `verification --status pending-owner-action --method postcard --by "<name>"` | Guidance and owner-reported status. Never "verified by Google". |

`status` shows the mode, the one next action (Check Eligibility, Connect Existing Profile, Complete Profile, Create Profile,
Verification Required, Review Recommendations) and everything that is unavailable without Google access.

## Improvement queue, reviews, posts, performance (still manual mode)

| Task | Command (`node seo/tools/seo-local-gbp.mjs …`) | Notes |
|---|---|---|
| Queue recommendations | `recommend [--html page.html]` | From the completeness checklist, website audit and unanswered reviews. Each has current value, proposed value, reason, evidence, expected benefit, confidence and approval status. Duplicates and rejected items are not re-queued. |
| Work the queue | `queue --move <id> --to review\|approved\|implementing\|verification\|completed\|rejected\|deferred\|failed --by "<name>"` | new → review → approved → implementing → verification → completed. Approval needs a name; completing needs evidence (owner-reported). |
| Share the existing queue | `queue --sync` | Adds/updates `gbp-…` entries (area `local`) in `seo/content-inventory.json` `issues[]` — the same queue as every other site issue. Mapping: new/review/failed→open, approved/implementing→approved, verification→fixed, completed→verified, deferred→deferred, rejected→wont-fix. No schema change. |
| Reviews | `reviews --import reviews.json --by "<name>"`, `--unanswered`, `--draft <id>`, `--approve <id> --by "<name>"`, `--posted <id> --by "<name>"` | Manual import (no live sync). Drafts avoid private details and promises, vary their wording, and need a named approver; the owner posts them. |
| Review requests | `review-request --channel email\|text\|website --link <url>` | Neutral wording to every customer: no rewards, no review-gating, no rating requests. |
| Posts | `posts --suggest`, `--add post.json --by "<name>"`, `--approve <id> --by "<name>"`, `--schedule <id> --when YYYY-MM-DD`, `--posted <id> --by "<name>"` | Suggestions only from recently published pages. Scheduling records an intended date; BWESEO never posts. |
| Performance | `performance --import figures.csv --by "<name>"` | Manual import of figures from the Business Profile interface (calls, website clicks, directions, search views…). 7/28/90-day totals and previous-period change; missing metrics shown as unavailable; kept separate from Search Console; nothing is estimated. |

## Rules the code enforces

- **Eligibility.** Online-only businesses, PO boxes, virtual offices and unstaffed shared spaces are refused with website-SEO alternatives; no storefront
  is invented. A service-area business must keep a real address and hide it.
- **No duplicates.** Creation is blocked until an existing-profile search is recorded and every likely or exact match is resolved
  (connect, claim, ownership request, or "different business" with a reason).
- **No invented facts.** Names must match the official name (no keywords, locations or hype); descriptions are ≤ 750 characters, link-free and
  claim-free; services, hours and categories are never guessed. The engine bundles no category list; categories are validated against a list supplied
  from the official API or copied from Google's picker.
- **Approval.** Creation requires a named administrator's approval of the exact values. The approval is bound to a fingerprint of the values.
- **Honest status.** Manual steps are "reported by the administrator" with name and time. The engine never says Google verified or published anything,
  never promises a verification method, and never bypasses verification.
- **No Google calls.** Phase 1 makes no network request. No scraping, no browser automation.
- **Limits** (name 100, description 750, photo sizes) follow Google's published guidance dated in `GUIDANCE_DATE` (`src/gbp-profile.mjs`); Google's own validation is authoritative.

## Files

`src/gbp-eligibility.mjs`, `gbp-discovery.mjs`, `gbp-profile.mjs`, `gbp-schema.mjs`, `gbp-state.mjs` (pure, tested), `seo-local-gbp.mjs` (CLI), tests in
`src/gbp.test.mjs` and `src/gbp-ops.test.mjs`. State lives in `seo/data/local-gbp/` (`state.json`, editable `draft.json`, `recommendations.json`, `reviews.json`, `posts.json`, `performance.json`) (private, git-ignored; no schema bump needed).

## Not built yet (needs the owner or later phases)

- Google OAuth, API-access detection, live profile sync and editing, live review and post management, API performance data, competitor analysis, scheduled
  monitoring and alerts, and the site dashboard section. **USER INPUT NEEDED:** Google Business Profile API access is granted per
  Google Cloud project after an application to Google; OAuth client credentials must be created by the owner. Until then these remain unavailable and
  must not be reported as working.
