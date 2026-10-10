# SEO QA (`/BWESEOQA`)

A page is not ready until every **Blocking** item passes. Report PASS / FAIL / N/A per item with
evidence. Any Blocking FAIL = overall FAIL; fix and re-run.

## Content QA

| # | Check | Blocking |
|---|---|---|
| C1 | Every factual claim is in the claims ledger and maps to a `verified` profile fact | Yes |
| C2 | No fabricated proof (testimonials, reviews, ratings, stats, case studies, awards, offices) | Yes |
| C3 | Demos/samples labeled at the point of display; relationships disclosed | Yes |
| C4 | Search intent is clear and satisfied early; page is genuinely useful | Yes |
| C5 | No keyword stuffing; no banned filler phrases (`content-standards.md`) | Yes |
| C6 | No duplicate/cannibalizing page (re-check inventory + source) | Yes |
| C7 | No ranking guarantees or regulated-outcome claims | Yes |
| C8 | Tone matches the brand voice; readable at a glance | No |

## On-page QA

| # | Check | Blocking |
|---|---|---|
| O1 | Title unique across the site, ≈ 50–60 chars, not clickbait | Yes |
| O2 | Meta description unique and useful | Yes |
| O3 | Exactly one H1, appropriate to the intent; logical H2/H3 order | Yes |
| O4 | Canonical absolute, self-referencing, production host — never a staging, preview or local URL | Yes |
| O5 | Indexable (no stray noindex) and in the sitemap / page registry | Yes |
| O6 | OG + Twitter tags page-specific (title, description, url); `og:url` is the same page as the canonical (equivalent URLs — trailing slash, fragment, case — are equal; a different path, host, scheme or query is a mismatch); declared `og:image:width`/`height` equal the real image size | No — but a mismatch is reported (`og-url-canonical`, `social-image-size`) |
| O7 | Schema valid JSON, supported by visible content, no conflicts/duplicates | Yes |
| O8 | Internal links: parent + planned in/out links exist; not orphaned; no broken links | Yes |
| O9 | CTA present, works (link target exists / form submits on staging), wording fits | Yes |
| O10 | Images load, have width/height, meaningful alt (decorative = empty alt) | Yes |
| O11 | Clean URL (lowercase, hyphens, no dates/IDs unless needed) | No |
| O12 | The H1 is visible in the server HTML — not inside an element with inline `opacity:0` / `visibility:hidden` that only JavaScript undoes (`above-fold-visible`). Hiding by class, `display:none` or the `hidden` attribute on the H1's own chain, or other content hidden in the H1's section, is **REVIEW REQUIRED**, not a failure | Yes for the certain case |
| O13 | A public sub-page has the site's navigation and footer when the home page does (`site-navigation`, `site-footer`). If the home page has none either, or can't be read, that is **REVIEW REQUIRED** / skipped; a noindex page is skipped | Yes where the home page has them |
| O14 | Every in-page `#anchor` in the navigation or footer has a target on the page (`nav-anchors`) — on a sub-page, section links must go to the home page (`/#pricing`) | Yes |

## Technical QA

| # | Check | Blocking |
|---|---|---|
| T1 | Project build succeeds | Yes |
| T2 | Project tests pass (plus `seo/tools` validator) | Yes |
| T3 | Route renders server-side (content in HTML) and returns 200; unknown sibling URL returns 404 | Yes |
| T4 | Mobile layout works (no horizontal scroll, tap targets, readable text) | Yes |
| T5 | No accessibility regression (headings, labels, contrast, focus, reduced motion) | Yes |
| T6 | No duplicate titles / duplicate routes introduced site-wide | Yes |
| T7 | Performance not worse (no new render-blocking assets, images sized) | No |
| T8 | robots.txt / sitemap / redirects unaffected or correctly updated | Yes |

QA runs **before** deploy (against a local build). When the project has staging, the page then
goes to staging for the staging review below. The equivalent checks on the **live production
page** — plus sitemap, internal links, environment leakage, Search Console and monitoring — are
`post-publication.md` (`/BWESEOPublish`), which is mandatory after every production deploy of an SEO
page. **Staging QA never replaces the production check.**

## Staging review (`/BWESEOQA <id> staging`)

Runs once the page is on staging (see `environments.md`). Start with
`node seo/tools/post-publish-check.mjs --id <id> --env staging --expect "<text only this page has>"`
(read-only; it prints **ENVIRONMENT: STAGING · SEARCH ENGINE INDEXING ACTIONS: DISABLED**), then
complete the checklist:

| Area | Checks | Who |
|---|---|---|
| Page function | Loads (this version — the `--expect` text is there), route works, same-site links work, CTA / form reachable (never submit a real form on staging), no obvious errors | Claude |
| SEO | Title, meta description, one H1, heading structure, canonical can't make staging the preferred URL, structured data valid, internal links, image alt text, sitemap behavior (a test artifact) | Claude |
| Environment | Staging clearly identified; hidden from search engines (strong = noindex header / meta or sign-in; robots.txt only = weak); no production contamination; no customer data that shouldn't be public | Claude |
| Content | Right business, services, places, prices; no fabricated claims (claims ledger vs. the profile); no placeholder, demo or test text | Claude (read the server HTML) + owner |
| Visual | Desktop and mobile layout, navigation, footer, spacing, horizontal overflow, broken images, CTA visibility | The owner, unless the project allows Claude to use a browser |

Record `staging.review: { result, date, sourceHash, url }` (`sourceHash` from
`node seo/tools/seo-state.mjs --hash <id>`). On PASS: **STAGING REVIEW PASSED** — give the owner the
staging URL and the visual checklist, and say **PRODUCTION DEPLOYMENT REQUIRES YOUR APPROVAL**. Don't
deploy. Record `staging.approval` only when the owner says it's approved. On FAIL: list the exact
fixes; after fixing, redeploy to staging and review again. Never request indexing for a staging URL.

### Statuses used by the page checks (`seo-page-checks.mjs`)

| Status | Meaning |
|---|---|
| ✓ pass | fine |
| ✗ fail | a defect the check can establish reliably from the HTML |
| ? **REVIEW REQUIRED** | looks off but the check can't be certain (may be an animation, a menu, a deliberate standalone page) — a person looks; never counted as a defect and never blocks |
| – skip | not enough information to judge (e.g. a social image hosted on another site is never fetched; the home page couldn't be read) |

Run them before deploy on a saved build/preview page, or let `post-publish-check.mjs` run them on staging and production:
`node seo/tools/seo-page-checks.mjs --html <page.html> --url <page URL> [--home <home.html>] [--public-dir public]`.

## How to verify

Prefer automated evidence: build output, test output, `curl -s -o /dev/null -w "%{http_code}"`
against a local preview or staging, grep of built HTML for the title/canonical/JSON-LD. Visual
checks (mobile layout) are done by the user if browser testing is not permitted in the project —
list them as "needs user check" rather than claiming PASS.

## Output

QA report table + overall PASS/FAIL + list of user-check items. Update the inventory entry's
`qa` field `{ "result": "pass|fail", "date": "YYYY-MM-DD", "sourceHash": "…" }` (or `staging.review`
for a staging review).
