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
- **Merging.** Keyword groups become ONE proposal only when they share a service/topic identity as well as an intent: "emergency
  plumbing" and "roof repair" are both `service` intent but stay separate pages; "emergency plumber" folds into "emergency plumbing"; a
  different place is a different page.
- **Approval.** proposed → draft → approved → published. Approval names the administrator and hashes the whole publish payload (versioned
  `v2:` SHA-256): destination path, title, description, H1, body, headings, FAQ, CTA, canonical, structured data, links (order-insensitive),
  images (src + alt) and indexability. Editing any of those voids the approval; private notes and check results are not part of it.
  `approve` requires a passing check of the CURRENT draft, and `move … --to published` re-validates the same representation. An approval
  recorded before this (no `hashVersion`) is **legacy**: it is never trusted, `status` shows "approval legacy - approve again", and
  publishing is refused until you run `check` and `approve` again. The engine never deploys. "Published" is recorded only after the owner deploys.
- **Replanning.** `plan` is repeatable. Opportunities keep their id, draft, checks, approval and history when the new plan still covers the
  same primary phrase, one of its phrases, or the same service identity. A changed target or primary phrase voids checks and approval
  (an approved opportunity returns to draft) and says so; a published opportunity is never rewritten, the different plan is offered as
  `pendingChange`. Work that no longer matches anything is moved to `retired[]` (with a reason and date) and is restored automatically if a
  later plan matches it again; opportunities with no work are simply dropped.
- **Indexing.** Never claim Google indexing from a sitemap change or submission; use Search Console evidence (`/BWESEOSearchConsole`).

## Data
`seo/data/landing/state.json` (private): `keywords[]` (with metric objects), `opportunities[]` (primary, secondary, intent, action,
target, score, status, draft, checks, approval, history, performance), `retired[]` (parked work, recoverable). Saves are atomic and serialized
by a lock file next to the state file (`state.json.lock`, removed automatically; a lock left by a dead process is taken over). The dashboard template reads this file (choose it with the file picker).

## City pages (`src/landing-city.mjs`)
Pure functions (no network, no writes) that extend the landing pipeline for city pages. A caller (a customer project or a dashboard)
holds the registry; the engine supplies the rules.
- **Registry.** `upsertEntry` is idempotent per city + state + service and refuses a route that belongs to another entry or already exists
  on the site (improve that page instead). Statuses: draft, researching, review-required, approved, published, unpublished, redirected, archived, failed.
- **Research brief.** `checkBrief` blocks unless service availability is `verified` by the business, every fact is marked verified,
  business-provided or assumption, verified facts carry a source URL and retrieval date, and at least one source exists.
- **No invented presence.** `localPresenceClaims` flags office, local-team, "visit us", licence and response-time wording that names the
  city; only the real home base may be stated. `cityReadiness` also blocks near-duplicate sibling pages and placeholder text.
- **lastmod.** `stampPublicChange` moves `lastmod` only when the public hash (title, description, H1, body, FAQ, canonical, structured
  data, links, indexability) changes. Rebuilds, draft notes and analytics never move it; future dates are refused.
- **Sitemap.** `sitemapEligibility` compares configured and observed state and reports disagreement as a failure.
  `planSitemapChanges` returns adds, removals and lastmod changes against the current urlset and never touches unrelated entries.
  Redirects, noindex, drafts, robots-blocked and non-canonical URLs are excluded.
- **robots.txt.** `checkRobotsSitemap` requires an absolute sitemap reference with no placeholder.
- **Release package.** `releasePackage` hashes revisions plus planned sitemap changes; an approval is bound to that hash and any later
  change voids it. Deploy, sitemap write and Search Console submission remain separate owner-approved production actions.

### City page command
`src/seo-landing-city.mjs` stores the registry in `seo/data/landing/cities.json` and walks the steps: add, brief, draft, package, approve,
published, verify. `verify` fetches each published page, `sitemap.xml` and `robots.txt` and checks status 200, one self-canonical, no
noindex (meta or X-Robots-Tag), not blocked by robots.txt, exactly one sitemap entry with the registry's `lastmod`, and the robots.txt
sitemap line; the report is `docs/seo/reports/city-verify-<date>.json`. The dashboard template shows the registry when you open `cities.json`.

### Runs anywhere
`landing-city.mjs`, `landing-quality.mjs` and their imports have no `node:` imports (hashing is `landing-hash.mjs`, parsers are `web-parse.mjs`), so a website's server code can call them directly, for example an admin tool on a Worker.

## What the checks establish

The quality gate (`landing-quality.mjs`) has three levels.
- **error** (blocks approval): objectively invalid or unsupported states - missing title, description or H1; an empty body; images with no alt attribute, a blank alt, or an empty alt on an image declared informative; unsupported claims (guaranteed rankings, superlatives, testimonials, customer counts, numeric results); prices not in the verified list; missing required call to action; duplicate titles, descriptions, H1s or near-duplicate text; same primary keyword as another page; location pages without a verified service-area fact or that are near-identical to each other. Publishing also requires a valid approval of the exact content.
- **warn**: likely worth fixing (title and description length, few headings or links).
- **review**: heuristic signals for a person to judge, never a block - fewer words than the threshold, and repetition of the primary phrase. Word count and phrase density are weak proxies: a short page can answer a narrow question completely, and a long one can say nothing. `alt-decorative` lists images marked decorative.

Alt text: a missing `alt` attribute (`alt` absent) is different from an intentional empty one (`alt: ""`, decorative). An image can set `informative: true` (or `decorative: false`) to say an empty alt is wrong for it. The gate cannot tell whether an alt text is *appropriate*; that needs a person.

Thresholds (`minWords`, `minWordsLocation`, `stuffingMinHits`, `stuffingDensity`, `stuffingWarnHits`, `titleMax`, `descriptionMin`, `descriptionMax`, `minHeadings`, `minLinks`) can be set per project in `seo-config.json` under `landing.qualityThresholds`. Defaults are in `THRESHOLDS`.

What automated checks cannot establish: that the content is accurate beyond the verified facts supplied, that claims are true, that the page is useful, that it will rank, or that it is indexed.
