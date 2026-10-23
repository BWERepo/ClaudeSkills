---
name: BWE-SEO-PUBLISH
description: Mandatory post-publication SEO check for a page that has just gone live in the current website project, using the BWE-SEO engine — environment-aware (LOCAL: not applicable; STAGING/PREVIEW: a technical check with SEARCH ENGINE INDEXING ACTIONS DISABLED; PRODUCTION: the full workflow). On production it verifies the page is really live (not just staging), free of staging/preview/localhost URLs in links, schema, social metadata and the sitemap, indexable (no noindex, robots.txt allows it, correct canonical, clean duplicates, crawlable HTML, title/description/H1, valid structured data), in the production sitemap, linked from relevant pages and not orphaned; decides navigation placement; gives the exact URL to inspect in Google Search Console and records the indexing-request status honestly; sets 7/30/90-day monitoring checkpoints; updates the SEO inventory; and writes a plain-language report. Never deploys, pushes, requests indexing or changes Search Console. Use when the user says "run the SEO post-publication checklist for this page", "post-publication SEO check", "the page is live — check it", "help Google find the new page", "is the new page indexable", or invokes /BWE-SEO-PUBLISH <page id or URL>, in any website project with a seo/ folder.
---

> `$BWESEO_ENGINE` = the BWE-SEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWE-SEO-PUBLISH

Engine: `$BWESEO_ENGINE/`. Follow
`docs/methodology/post-publication.md` exactly; this file is the run order.

This skill does **not** deploy. If the page isn't on production yet, it stops at step 3 and says
what will be checked after the (separately authorized) deploy.

**Environment first** (`docs/methodology/environments.md`). The checker classifies the URL from
`seo-config.json` → `environments` and says so at the top of its report:

- **LOCAL** → **POST-PUBLICATION CHECK NOT APPLICABLE** — the page is local and not available to
  search engines. Stop (exit 4).
- **STAGING / PREVIEW / unknown host** (`--env staging`, or a staging `--url`) → **STAGING
  PUBLICATION CHECK · ENVIRONMENT: STAGING · SEARCH ENGINE INDEXING ACTIONS: DISABLED.** Report its
  technical findings and the "needs your check" list; say the page must be deployed to production
  before Search Console indexing actions are appropriate. Never give Search Console steps, never
  patch the inventory to `published`, never mention submitting anything. (This is what the staging
  review in `/BWE-SEO-QA <id> staging` runs.)
- **PRODUCTION** (the default) → the full workflow below. Only production may advance to search-engine
  discovery / indexing. Staging QA never replaces this check — even when staging passed, production
  is verified from scratch.

1. **Project guard** (`/BWE-SEO` Step 0): the repo matches `seo/seo-config.json`; run
   `node seo/tools/validate-seo-data.mjs`. All URLs come from this project's config and inventory —
   never from another project, never assumed.
2. **Identify the page** (argument = inventory id or URL). Read its inventory entry (title, url,
   parent, `linksFrom`, `relatedPages`, `qa`, any recorded `postPublication.searchConsole`). If the
   project's copy of `seo/tools/post-publish-check.mjs` is missing or older than the engine's, run
   `/BWE-SEO-ENGINE install --dry-run --update` (never copy engine files by hand).
3. **Run the checker** from the repo root (read-only GETs):
   ```
   node seo/tools/post-publish-check.mjs --id <id> --expect "<the page's H1 or a sentence only it has>" \
     --published-on <deploy date, if known> --out docs/seo/reports/publish-<id>-<YYYY-MM-DD>.json --patch
   ```
   (The checker also runs the page checks: og:url vs canonical, social-image size, H1 visible in the server HTML, shared
   navigation/footer — `✗` is a defect, `?` REVIEW REQUIRED is not.)
   Exit 2 = **PAGE NOT LIVE — INDEXING STEPS CANNOT YET BE COMPLETED.** → report that verbatim,
   say where the page does exist (staging → "production status: NOT DEPLOYED"; local), record
   `postPublication.result: "not-live"`, keep status `review`, and stop. If the inventory already
   said `published`, report **PUBLISHED STATUS CONFLICT — PRODUCTION NOT VERIFIED**.
4. **Review every ✗ and ⚠** with the methodology: explain in plain words what could prevent or
   confuse indexing. **CRITICAL SEO ERRORS** come first — an intended public page that says noindex
   on production, a robots.txt block, a canonical to a staging/preview/local URL, staging URLs in the
   production sitemap. Environment-leakage findings (links, schema, `og:` metadata, stray staging
   hostnames) are errors. Don't fix site code without approval.
5. **Internal links:** compare the found inbound links with the page map ("pages that should link
   TO it"). Recommend specific missing links (page + where on it) only where they help visitors.
6. **Navigation decision:** primary / service / resource / footer / contextual-only (never
   "sitemap only" for a commercial page) — with a one-line reason.
7. **Google readiness** (engine 1.7.0): map the checker's result to the durable record —
   `node seo/tools/seo-google.mjs readiness <id>` (or `googleReadinessFromCheck` on the saved JSON) — and store it as
   `postPublication.google.readiness { status: PASSED | FAILED | UNKNOWN, checkedAt, source, items, failures,
   warnings }` plus `postPublication.google.sitemap { included, verifiedAt, source }`. **PASSED means only "the page
   appears technically ready for Google"** (production URL, not noindex, robots allows, correct HTTPS production
   canonical, no staging leaks, in a well-formed production sitemap with a sensible lastmod, internal links, not
   orphaned, title / description / H1, valid structured data, staging still hidden) — never that Google has
   discovered, crawled or indexed it. A production 5xx / 522 / timeout records `UNKNOWN` (health), never `FAILED`.
   **Search Console & other engines:** the sitemap is a site-level fact — if it is already registered (see
   `seo-config.json`) say so and do not ask for anything; otherwise `/BWE-SEO` routes registration to
   `/BWE-SEO-SEARCH-CONSOLE`. Manual **Request Indexing** is an *optional accelerator*, mentioned once at most
   and never required. Mention the project's existing Bing/IndexNow mechanism only if it has one; never add services.
8. **Update the inventory** (only if live): apply the checker's `inventoryPatch` plus
   `navigation`, keep unknowns as `"unknown"`, then re-run the validator.
9. **Write the report** `docs/seo/reports/publish-<id>-<YYYY-MM-DD>.md` in the methodology's
   format, ending with **WHAT YOU NEED TO DO** (as few steps as possible; "nothing" if so).
    (If the check reports `PRODUCTION CHECK UNAVAILABLE` — a 5xx, 522 or timeout — nothing is recorded or
    changed: it is a health failure, not evidence the page isn't live. Try again shortly.)
10. **When the owner tells you** they ran a Live URL Test or clicked Request Indexing (both optional), record it
    (`liveUrlTest`, `urlInspection: "verified"`, `indexingRequest: "REQUESTED"`, `requestedOn`,
    `requestSource: "owner:<date> chat"`). If they decide not to, keep `NOT REQUESTED` and put
    that decision in `requestSource` so /BWE-SEO stops asking. Never infer either. If the page had a
    `hold`, the owner's go-ahead to deploy ended it — remove it.

Afterwards the page's 7/30/90-day reviews run through `/BWE-SEO-SEARCH-CONSOLE` →
`/BWE-SEO-REFRESH` → `/BWE-SEO-REPORT`.
