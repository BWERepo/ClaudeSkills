# Landing pages (SEO Landing Page Generator)

A reusable, customer-neutral pipeline: keywords → intent groups → new-vs-improve decision → draft → quality gate → administrator
approval → publish (by the owner) → Search Console tracking. Code: `src/landing-keywords.mjs`, `landing-opportunities.mjs`,
`landing-quality.mjs`, CLI `src/seo-landing.mjs`, skill `/BWESEOLanding`, dashboard `templates/landing-dashboard.html`.

## Rules
- **One page per intent.** Keywords that differ slightly (cheap / low cost / affordable; web / website; designer / design) share one
  proposal. A second page needs a clearly different searcher goal.
- **Improve before creating.** An existing page whose title/H1 already covers the primary phrase gets the keyword, not a rival page.
- **No invented numbers.** Volume, difficulty and CPC are `unavailable` unless supplied with a source and a research date.
  Competition is `unavailable` without sourced, dated evidence. Priority comes from relevance, buyer intent and conversion potential.
- **Source of truth is the live site** for prices, terms, guarantees and service areas. Place pages need a verified service-area fact
  and unique local content; near-identical city pages are blocked (doorway pages).
- **Quality gate** (errors block approval): missing/duplicate title, description or H1; thin content; keyword stuffing; images without
  alt text; unsupported claims (ranking promises, superlatives, testimonials, customer counts, percentage results); prices not in the
  verified list; missing primary CTA; duplicate content; same primary keyword as another page.
- **Approval.** proposed → draft → approved → published. Approval names the administrator and hashes the exact content; editing voids
  it. The engine never deploys. "Published" is recorded only after the owner deploys.
- **Indexing.** Never claim Google indexing from a sitemap change or submission; use Search Console evidence (`/BWESEOSearchConsole`).

## Data
`seo/data/landing/state.json` (private): `keywords[]` (with metric objects), `opportunities[]` (primary, secondary, intent, action,
target, score, status, checks, approval, performance). The dashboard template reads this file (choose it with the file picker).
