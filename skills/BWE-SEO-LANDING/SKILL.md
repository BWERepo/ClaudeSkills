---
name: BWE-SEO-LANDING
description: SEO Landing Page Generator — turns a keyword list into reviewed, conversion-focused landing page proposals for the current website project, deciding new page vs improve existing, drafting pages, running the quality gate, and requiring explicit administrator approval before anything is published. Use when the user says "landing pages", "target these keywords", "keyword import", or invokes /BWE-SEO-LANDING, in any website project.
---

> `$BWESEO_ENGINE` = the BWE-SEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWE-SEO-LANDING

Read `docs/methodology/landing-pages.md` first. This skill reuses `/BWE-SEO-OPPORTUNITIES`, `/BWE-SEO-CONTENT-PLAN`, `/BWE-SEO-CREATE-PAGE` and
`/BWE-SEO-PUBLISH`; it adds keyword intake, the new-vs-improve decision, the quality gate and the approval gate. It never publishes.

1. Project guard (`/BWE-SEO` Step 0). Read the LIVE site (sitemap, titles, H1s, prices, terms) — the live site is the source of truth
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
6. Draft (only for approved proposals) with `/BWE-SEO-CREATE-PAGE`: original, helpful content; only prices, terms and guarantees found on
   the live site; no invented testimonials, results, counts or locations; one primary CTA.
7. Gate: `node seo/tools/seo-landing.mjs check <id> --page page.json --prices "<verified prices>" --cta "<CTA text>" [--others pages.json]`.
   Fix every ERROR. Then `/BWE-SEO-SCHEMA`, `/BWE-SEO-INTERNAL-LINKS`, `/BWE-SEO-TECHNICAL` and `/BWE-SEO-QA` (canonical, sitemap, robots/noindex,
   structured data, links, redirects, mobile, accessibility).
8. Approval: `approve <id> --by "<administrator>"` approves the exact content; any later edit voids it. `move <id> --to published`
   is refused without a valid approval and only records state — deploying is a separate, owner-authorised step.
9. After publishing: `/BWE-SEO-SEARCH-CONSOLE`. A sitemap update or submission is never proof of indexing; only Search Console says "indexed".
