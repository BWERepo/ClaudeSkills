---
name: BWESEOLanding
description: SEO Landing Page Generator — turns a keyword list into reviewed, conversion-focused landing page proposals for the current website project, deciding new page vs improve existing, drafting pages, running the quality gate, and requiring explicit administrator approval before anything is published. Use when the user says "landing pages", "target these keywords", "keyword import", or invokes /BWESEOLanding, in any website project.
---

> `$BWESEO_ENGINE` = the canonical BWESEO engine directory: `$BWESEO_ENGINE_HOME` if set, else the `path` in
> `~/.claude/bweseo/engine-location.json` (see `/BWESEOInstall`). Engine code lives in `$BWESEO_ENGINE/src`, methodology in
> `$BWESEO_ENGINE/docs/methodology`.

# BWESEOLanding

Read `docs/methodology/landing-pages.md` first. This skill reuses `/BWESEOOpportunities`, `/BWESEOContentPlan`, `/BWESEOCreatePage` and
`/BWESEOPublish`; it adds keyword intake, the new-vs-improve decision, the quality gate and the approval gate. It never publishes.

1. Project guard (`/BWESEO` Step 0). Read the LIVE site (sitemap, titles, H1s, prices, terms) — the live site is the source of truth
   for prices, guarantees and service areas. Save the existing pages as `site-pages.json` (`{ "pages": [{ path, title, h1, h2[], description }] }`).
2. Intake: `node seo/tools/seo-landing.mjs import <keywords.csv>` or `add "<keyword>"`. A metric (volume, difficulty, CPC) is a number
   only with a source and a research date; otherwise it stays `unavailable`. Never estimate one.
3. Plan: `node seo/tools/seo-landing.mjs plan --pages site-pages.json [--offerings "<verified services>"] [--brand "<name>"]`.
   Same-intent keywords become ONE proposal. A page that already covers the intent in its title/H1 wins: the action is
   `improve-existing`. Check Google results only when search access exists; never claim what you did not see.
4. Local keywords (a place name): propose a page only if the live site already makes a service-area claim for that place; otherwise
   leave it out and ask the owner. Never create near-identical city pages.
5. Present the table (primary + intent, related keywords, competing page, new/improve, URL/title, customer value, evidence, CTA) and
   ask for approval of the proposals. **Approval needed** must be labelled prominently.
6. Draft (only for approved proposals) with `/BWESEOCreatePage`: original, helpful content; only prices, terms and guarantees found on
   the live site; no invented testimonials, results, counts or locations; one primary CTA.
7. Gate: `node seo/tools/seo-landing.mjs check <id> --page page.json --prices "<verified prices>" --cta "<CTA text>" [--others pages.json]`.
   Fix every ERROR. Then `/BWESEOSchema`, `/BWESEOInternalLinks`, `/BWESEOTechnical` and `/BWESEOQA` (canonical, sitemap, robots/noindex,
   structured data, links, redirects, mobile, accessibility).
8. Approval: `approve <id> --by "<administrator>"` approves the exact content; any later edit voids it. `move <id> --to published`
   is refused without a valid approval and only records state — deploying is a separate, owner-authorised step.
9. After publishing: `/BWESEOSearchConsole`. A sitemap update or submission is never proof of indexing; only Search Console says "indexed".

## City pages (wizard)
For a page about one city: `node seo/tools/seo-landing-city.mjs add "<City>" <ST> --home-base "<where the business really is>"`, then
`brief <id> --file brief.json` (service availability must be confirmed by the owner; every fact marked verified, business-provided or
assumption; sources with URL and date), `draft <id> --page page.json` (quality gate, near-duplicate and local-presence checks),
`package --origin <url> --sitemap sitemap.xml --robots robots.txt` (sitemap additions with stable lastmod, robots check, link report),
and stop: **Approval needed** from the owner for that package hash. `approve --package <hash> --by "<name>"`, the owner deploys,
`published <id> --by "<name>"`, then `verify --origin <url>`. Verified is never "indexed"; Search Console submission is a separate owner decision.
Never claim an office, staff, licence or response time in a city without evidence; a city that already has a page is improved, not duplicated.
