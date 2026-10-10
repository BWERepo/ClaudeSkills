# Post-publication SEO check (`/BWESEOPublish`)

Runs **after** an approved page is live on the production site. It can also be run just before a
deploy as a dry run: it will stop at step 1 and list what must be checked afterwards. Goal: take
every reasonable step to help search engines discover, crawl and index the page, then set up
monitoring.

This workflow **never deploys, never pushes, never requests indexing and never changes Search
Console.** Deploying is a separate, explicitly authorized step through the project's own workflow
(`seo/seo-config.json` → `workflows`). Nothing here is tied to one business: every URL comes from
the current project's `seo/seo-config.json` and `seo/content-inventory.json`.

## Where it sits in the lifecycle

```
DISCOVER OPPORTUNITY → PLAN → APPROVE → CREATE PAGE → SEO QA → DEPLOY TO STAGING
→ STAGING REVIEW → HUMAN APPROVAL → DEPLOY TO PRODUCTION → POST-PUBLICATION SEO CHECK
→ SEARCH ENGINE DISCOVERY / INDEXING → MONITOR → MEASURE → IMPROVE

/BWESEOCreatePage → /BWESEOQA → staging deploy → /BWESEOQA <id> staging → owner's approval
→ production deploy (project workflow) → /BWESEOPublish → /BWESEOSearchConsole (7/30/90-day
reviews) → /BWESEORefresh → /BWESEOReport
```

(A project with no staging goes from SEO QA to the owner's production approval.)

## Environments — only PRODUCTION gets the full workflow

The URL's environment comes from `seo-config.json` → `environments` (see `environments.md`) and
decides what the check does. **Only PRODUCTION may advance to search-engine discovery / indexing.**

| Environment | What the check does | Report headline | Exit |
|---|---|---|---|
| LOCAL | Nothing — no requests | **POST-PUBLICATION CHECK NOT APPLICABLE** — this page is local and is not available to search engines | 4 |
| STAGING / PREVIEW / UNKNOWN host | A technical test (it loads, links work, SEO basics, hidden from search engines, canonical can't make it the preferred URL, schema/social URLs) with **SEARCH ENGINE INDEXING ACTIONS: DISABLED**. No Search Console, no sitemap submission, no IndexNow, no inventory `published` patch | **STAGING PUBLICATION CHECK** — the page must be deployed to production before Search Console indexing actions are appropriate | 0 passed · 1 problems · 2 not on staging |
| PRODUCTION | The full workflow below, plus the environment-leakage checks | **SEO POST-PUBLICATION CHECK** · ENVIRONMENT: PRODUCTION | 0 · 1 · 2 |

`--env staging` checks the page's copy on the configured staging site (used by the staging review);
the default is production. Passing a staging or preview `--url` gets the staging behaviour — the
checker never treats a non-production URL as the live page.

An engine-created page (`approvedBy: "user"`) can only be `published` in the inventory once this
check has confirmed it is live on production — the validator enforces it.

## The checker

```
node seo/tools/post-publish-check.mjs --id <inventory-id> [--env production|staging]
    [--expect "<text only this page has>"] [--published-on YYYY-MM-DD]
    [--out docs/seo/reports/publish-<id>-<date>.json] [--patch]
```

Vendored from `src/`. It reads the environments (production, staging, preview hosts), sitemap, robots,
IndexNow key and Search Console settings from `seo/seo-config.json`, and the page's URL, title,
parent, planned inbound links and any recorded Search Console status from the inventory. It
fetches the live site **read-only** and prints the report below, plus an `inventoryPatch` to
apply. It never logs in, submits, or changes anything.

Exit codes: 0 = live and ready · 1 = live, action required · 2 = PAGE NOT LIVE · 3 = usage/config
error · 4 = not applicable (local). `--patch` prints the inventory patch — production only.

## 1. Verify the live page (gate)

- The production URL (`website` + inventory `url`) resolves with **200**.
- The correct page is returned: its `<title>` matches the inventory title, and every `--expect`
  string (and the inventory `verifyText`, if set) is present in the server HTML.
- HTTPS works, and the `http://` version redirects to HTTPS.
- No inappropriate redirect (only trailing-slash / www-apex normalization to the same page).
- The final canonical URL is known.
- The URL checked is the production host, never a staging host; the tool also checks staging so it
  can say when a page exists **only** on staging — then production status is **NOT DEPLOYED**.
  Staging never counts as published.

**If the page is not live, STOP** and report exactly:

> **PAGE NOT LIVE — INDEXING STEPS CANNOT YET BE COMPLETED.**

…with what was found (status, redirect, staging-only). Keep the inventory status `review`, record
`postPublication.result: "not-live"`, and never claim indexing readiness for a page that exists
only locally or on staging.

## 2. Indexability

Flag anything that could prevent or confuse indexing: `noindex` (meta robots / googlebot /
`X-Robots-Tag`); robots.txt blocking the path for Googlebot, Bingbot or `*` (a crawler obeys only
its most specific group); canonical missing, duplicated, relative, non-HTTPS, on staging or
pointing at another page; non-200 status; authentication; unintended duplicates (trailing-slash,
www/apex and `http://` variants must redirect to, or canonicalize to, the page); content that only
appears after JavaScript; missing or poor title, meta description or H1; invalid JSON-LD, and any
Review/AggregateRating markup (verify it's real).

A staging-only `noindex` reaching production is the classic environment mistake: an intended
public page (`indexable` isn't false) that says `noindex` on production, a robots.txt that blocks
it, or a canonical pointing to a staging / preview / local URL is a **CRITICAL SEO ERROR**, listed
first in the report. It is checked on the production response itself, never inferred from staging.

## 3. Sitemap

When the site uses a sitemap, check the **generated production** sitemap (not the source code):
it exists and is accessible; the canonical URL is included exactly (HTTPS, production host,
canonical form); no staging, preview or localhost URLs (**CRITICAL** if any); no duplicate or variant
versions. A staging sitemap is a test artifact and is never submitted.

## 4. Internal links

The checker fetches the sitemap's pages and lists every link to the new page — the linking page,
the anchor text, and whether the link is in the navigation, the footer or the body. It also checks:

- **Not orphaned**: at least one indexable page links to it.
- **Related pages connected**: the parent/pillar links to it, the planned "links TO it"
  (`linksFrom` in the inventory) exist, and the page links out to its related pages.

Links must be useful to visitors and contextually appropriate — never added "for SEO". When
important links are missing, **recommend** specific pages and places. Do not make substantial or
unrelated page changes without approval.

## 4a. Page-quality checks (production and staging)

`post-publish-check.mjs` also runs the reusable checks in `seo-page-checks.mjs` (shown under ON-PAGE SEO on production, SEO on staging):

- **`og:url` matches the canonical** — replaces the old "og:url differs" note. Trailing slash, fragment, host/scheme case and default ports are
  ignored; a different path, host (incl. `www`), scheme or query is reported with what differs.
- **Social image size** — the declared `og:image:width`/`height` are compared with the real image (PNG, JPEG, GIF, WebP), read only when the image
  is on the same site as the page. A remote image, an unreachable one or an unknown format is **skipped**, never failed.
- **Above-the-fold visibility** — the server HTML's H1 must not sit inside `opacity:0` / `visibility:hidden` (a slow first paint). Uncertain hiding
  is **REVIEW REQUIRED**.
- **Shared navigation and footer** — a public sub-page is compared with the home page; dead `#anchors` in the navigation/footer are failures.
  Noindex pages and unreadable home pages are skipped.

On production these never block the verdict (ON-PAGE SEO is advisory); on staging a ✗ makes the verdict **STAGING CHECK FOUND PROBLEMS**.
REVIEW REQUIRED (?) never blocks either.

## 4b. Environment leakage (production only)

Production output must not reference staging, preview, localhost or development hosts:

- links on the page (an error unless a verified intentional reason is recorded)
- structured data (`url`, `@id`, `sameAs`, `logo`, `image`, `offers`, breadcrumbs)
- `og:url`, `og:image`, `twitter:image` and other absolute metadata URLs
- anywhere else in the HTML (the contamination scan — e.g. a hard-coded staging hostname)

## 5. Navigation decision

| Placement | Use for |
|---|---|
| Primary navigation | The few things most visitors look for (core service, pricing, contact) |
| Service navigation | A main service, when the site has a services menu |
| Resource navigation | Guides/articles, when the site has a resources area |
| Footer | Important secondary pages (key services, service areas, policies) |
| Sitemap only | Almost never right — it means the page is orphaned |
| Contextual links only | Supporting pages reached from their parent and related pages |

Not every SEO page belongs in the main menu. Decide from user experience, site architecture and
importance; record it as `navigation` (with a reason) in the inventory. Menu changes are site
changes and need approval.

## 6. Google Search Console

- Is it configured? Use `seo-config.json` → `analytics.searchConsole` (property, access) and, as
  supporting evidence, a `google-site-verification` meta tag on the live site. DNS-verified
  domain properties leave no trace on the page — say "configured per project config" or "unknown".
- If legitimate access exists through the project's approved workflow (e.g. owner exports in
  `seo/data/`), use it. **Never request, expose or hard-code credentials.**
- Always give the exact production URL to inspect (the canonical URL).
- When manual action is required, display:

```
GOOGLE SEARCH CONSOLE — MANUAL ACTION REQUIRED
1. Open Google Search Console.
2. Select the correct website property.
3. Paste the exact production URL into URL Inspection: <canonical URL>
4. Run the inspection.
5. Confirm Google can access the page.
6. If appropriate, select Request Indexing.
```

Requesting indexing does not guarantee indexing or ranking — never say otherwise.

**The Google lifecycle (engine 1.4.0)** — setup, Live URL Test, indexing request, sitemap, indexed,
monitoring — is separate facts, none implying the next; see `workflow-state.md` and the project's
`SEO-OPERATIONS.md`. A request is not an indexed page.

**Indexing request status** is recorded as `REQUESTED`, `NOT REQUESTED`, `REQUEST FAILED` or `UNKNOWN`, based only
on verified information: `REQUESTED` needs the owner's confirmation (with date) or Search Console
data showing it; `NOT REQUESTED` needs the owner saying it wasn't done; otherwise `UNKNOWN`.
**Never mark it REQUESTED because the checklist recommends it.** URL inspection is `verified` only
when someone actually ran it and reported the result.

## 7. Sitemap submission status

Record once per project (`seo-config.json` → `analytics.searchConsole.sitemap` — `submitted`, `status`,
`verifiedOn`, `lastRead`, `discoveredPages`; the older `sitemapSubmission` flag still reads) whether
the sitemap has been submitted in Search Console, and when that was verified. Do **not** resubmit
the sitemap for every new page when it is already submitted and auto-updates. If submission has
not been verified, report:

> **SITEMAP SUBMISSION STATUS — VERIFY IN SEARCH CONSOLE**

## 8. Other search engines

Document, from the project config and the live site, whether the site uses Bing Webmaster Tools
(e.g. an `msvalidate.01` tag), IndexNow (key file resolves on production) or another discovery
mechanism it already supports. Use only what already exists: point the owner to the project's own
mechanism, or submit through it only if the user explicitly approves that action. **Do not add
third-party services, APIs or indexing services.** Google stays the primary focus unless the
business profile says otherwise.

## 9. Update the SEO inventory

Only when step 1 passed: `status: "published"`, `publishedOn`, `productionUrl`, `canonicalUrl`,
`navigation`, `lastReviewed`, `nextReview` (the 7-day date), `relatedPages`, and a
`postPublication` record — `checkedOn`, `result` (`ready` / `action-required`),
`sitemapStatus`, `internalLinkStatus`, `inboundLinks`, `searchConsole` (`property`,
`urlInspection`, `indexingRequest`, `requestedOn`, `requestSource`), `monitoring` (review dates) and
`report`. The QA date stays in `qa.date`. Unknown values are written as `"unknown"` — never guessed.

## 10. Monitoring baseline and review windows

Record the publication date so later analysis compares before/after. Don't expect ranking data
immediately. Over time monitoring covers: indexed / not indexed, impressions, clicks, CTR, average
position, queries and query changes, page performance over time, and conversions where legitimate
tracking exists.

| Checkpoint | Check |
|---|---|
| **7 days after publication** | Has Google discovered / indexed the page (where data is available)? Technical problems? Obvious Search Console issues? |
| **30 days** | Impressions, queries, clicks, CTR, average-position trends; internal-link opportunities; does the search intent look right? |
| **90 days** | A real performance review: queries producing impressions, ranking trends, traffic, conversions, content gaps, weak sections, title/description opportunities, cannibalization, internal links — and whether to expand, revise, consolidate, or leave the page alone |

These are review checkpoints, not promises that meaningful data will exist. **Do not rewrite a page
just because it hasn't ranked quickly.** Reviews are run with `/BWESEOSearchConsole` (data) and
`/BWESEORefresh` (decisions), and summarized in `/BWESEOReport`.

## 11. The report

Every run writes `docs/seo/reports/publish-<inventory-id>-<YYYY-MM-DD>.md` in this shape (the
checker prints it; add the navigation decision and link recommendations):

```
SEO POST-PUBLICATION CHECK
ENVIRONMENT: PRODUCTION
SEARCH ENGINE INDEXING ACTIONS: ENABLED — only once this check passes
Page: <name>
Production URL: <url>

LIVE PAGE            ✓/✗ Page available · ✓/✗ HTTPS · ✓/✗ Correct production URL
INDEXING             ✓/✗ Indexable · ✓/✗ robots.txt allows crawling · ✓/✗ No accidental noindex · ✓/✗ Canonical correct
SITEMAP              ✓/✗ Sitemap available · ✓/✗ Page included · ✓/✗ No staging, preview or local URLs
INTERNAL LINKS       ✓/✗ Incoming internal links · ✓/✗ Related pages connected · ✓/✗ Not orphaned
ON-PAGE SEO          ✓/✗ Title · ✓/✗ Meta description · ✓/✗ H1 · ✓/✗ Structured data where applicable
ENVIRONMENT          ✓/✗ Links stay on production · ✓/✗ Schema · ✓/✗ Social metadata · ✓/✗ No staging/dev references
CRITICAL SEO ERRORS  (only when there are any — production noindex, robots block, staging canonical, staging URLs in the sitemap)
GOOGLE SEARCH CONSOLE Property: known/unknown · URL inspection: verified/not verified · Indexing request: requested/not requested/unknown
MANUAL ACTIONS REQUIRED   (only actions that truly need the user)
MONITORING           Publication date · 7-day review · 30-day review · 90-day review
OVERALL STATUS:      READY FOR SEARCH ENGINE DISCOVERY  or  ACTION REQUIRED BEFORE INDEXING

WHAT YOU NEED TO DO
1. …   (as few steps as possible; say so when there are none)
```

Never mark a page READY when a known technical problem could prevent indexing (any ✗ in the
live, indexing, sitemap, internal-link or environment sections). `⚠` marks a warning that doesn't
block.

The staging report has the same idea with its own sections (PAGE · ENVIRONMENT · SEO · LINKS ·
SITEMAP), a **NEEDS YOUR CHECK** list (desktop and mobile layout, navigation, footer, images, CTA
visibility, content) and ends with "Do NOT request indexing or submit anything to a search engine
for this URL."
