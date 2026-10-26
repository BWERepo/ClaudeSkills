---
name: BWE-SEO-QA
description: "SEO QA gate for a page in the current website project using the BWE-SEO engine — content checks (every claim verified, no fabricated proof, labeled demos, clear intent, no stuffing, no cannibalization), on-page checks (unique title/description, one H1, canonical, indexability, schema validity, internal links, CTA, images/alt) and technical checks (build, tests, SSR/200/404, mobile, accessibility, sitemap). Any blocking failure fails QA. `/BWE-SEO-QA <page> staging` is the STAGING REVIEW: page function, SEO, environment (hidden from search engines, no production contamination) and content checks on the staging URL with SEARCH ENGINE INDEXING ACTIONS DISABLED, visual checks listed for the owner, then it stops at the owner's staging approval. Use when the user says \"SEO QA\", \"check this page before publishing\", \"staging review\", \"review the page on staging\", or invokes /BWE-SEO-QA <page> [staging], in any website project."
---

> `$BWESEO_ENGINE` = the BWE-SEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWE-SEO-QA

1. Project guard (`/BWE-SEO` Step 0).
2. Identify the page (inventory id / URL / route file).
3. Run every item in `$BWESEO_ENGINE/docs/methodology/qa-checklists.md` (Content,
   On-page, Technical). Use real evidence: build + test output, the validator, built/served HTML
   (`curl` against staging or a local preview for status codes and head tags), the claims ledger
   vs. `seo/business-profile.json`.
   Also run the reusable page checks on the built/served page before deploy:
   `node seo/tools/seo-page-checks.mjs --html <page.html> --url <page URL> --home <home.html> --public-dir public`
   (og:url vs canonical, social-image size, H1 visible in the server HTML, shared navigation/footer, dead `#anchors`).
   A ✗ is a defect; a `?` REVIEW REQUIRED is for a person to look at — never report it as a failure.
4. Items that need eyes (mobile layout, visual CTA) → "needs user check" unless the project
   allows browser testing. Never mark them PASS without evidence.
5. Output the QA table + overall PASS/FAIL. Record state (`docs/methodology/workflow-state.md`): record
   `qa: { result, date, sourceHash, report }` on the inventory entry, where `sourceHash` comes from
   `node seo/tools/seo-state.mjs --hash <id>` run AFTER the last fix (a later edit changes the hash,
   and /BWE-SEO then asks for QA again). A FAIL lists the exact fixes; don't publish on FAIL. A page
   on `hold` can still be QA'd; its deployment stays paused.
6. QA is pre-deploy. When the project has staging (`seo-config.json` → `environments.staging.status:
   "configured"`), a passed QA leads to the staging deploy, then the staging review below.
   Otherwise, after the user approves and the page is live on production, run `/BWE-SEO-PUBLISH` —
   the post-publication check is mandatory.

## Staging review — `/BWE-SEO-QA <page> staging`

Follow `docs/methodology/qa-checklists.md` → Staging review.

1. Project guard; identify the page; confirm staging is configured (if not: "STAGING ENVIRONMENT:
   NOT CONFIGURED" — nothing to review).
2. Say at the top: **ENVIRONMENT: STAGING · SEARCH ENGINE INDEXING ACTIONS: DISABLED. This
   environment is for testing only. Do not request indexing for this URL.**
3. Run `node seo/tools/post-publish-check.mjs --id <id> --env staging --expect "<text only this page
   has>"` (read-only). Exit 2 = the current version isn't on staging → say so; deploying it is the
   next step. Then check the content against the claims ledger and the profile in the server HTML
   (right business, services, places, prices; no placeholder/demo/test text; no fabricated claims).
4. Visual checks (desktop, mobile, navigation, footer, spacing, overflow, images, CTA) are
   "needs your check" unless the project allows Claude to use a browser.
5. Record `staging.review: { result, date, sourceHash, url }` (`sourceHash` from
   `node seo/tools/seo-state.mjs --hash <id>`).
6. PASS → show **STAGING REVIEW PASSED**, the staging URL and the visual checklist, then:
   **PRODUCTION DEPLOYMENT REQUIRES YOUR APPROVAL.** Don't deploy. Record `staging.approval` only
   when the owner says it's approved — and that still isn't permission to deploy to production.
   FAIL → the exact fixes; after fixing, redeploy to staging and review again.
