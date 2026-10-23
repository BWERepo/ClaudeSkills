---
name: BWE-SEO-TECHNICAL
description: Technical SEO audit of the current website project (or a single page) using the BWE-SEO engine — crawl/index rules, robots per-agent groups, environment protection (staging/preview hidden from search engines, production indexable, no staging URLs leaking into production canonicals, sitemap, links, schema or metadata), sitemap, canonicals, 404/503 status codes, redirects, SSR visibility, metadata uniqueness, OG tags, internal anchors, performance and SEO-relevant accessibility. Read-only; outputs a findings table with suggested regression tests. Use when the user says "technical SEO", "check robots/sitemap/canonicals", or invokes /BWE-SEO-TECHNICAL, in any website project.
---

> `$BWESEO_ENGINE` = the BWE-SEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWE-SEO-TECHNICAL

1. Project guard (`/BWE-SEO` Step 0).
2. Scope: whole site by default; a single URL/route if the user names one (used by
   `/BWE-SEO-CREATE-PAGE` and `/BWE-SEO-QA`).
   When the argument is an inventory `issues[]` id (that's how `/BWE-SEO` routes a site issue), scope
   the run to that issue: re-check it, propose the fix, and record the outcome on that entry.
3. Run every check in `$BWESEO_ENGINE/docs/methodology/technical-seo.md` (and the
   environment rules in `environments.md`), locating things via the adapter. Say which environment
   each finding was measured on; production indexability is only ever measured on production. Prefer evidence from source + build output + `curl` against staging
   or a local preview (status codes, headers, server HTML). Don't use browser automation if the
   project forbids it — list visual checks for the user instead.
   For a whole-site run, also run the read-only site checks against production:
   `node seo/tools/seo-site-checks.mjs` (add `--demo-host <host>` for each demo or example site on the
   business's domain). They cover http/www consolidation in one 301, robots.txt on every production host
   (including CDN-managed blocks), every sitemap URL (200, indexable, self-canonical, dated), 301/308 for
   trailing-slash and uppercase variants, linked pages that robots.txt blocks while they say noindex,
   internal links to the key (P1) pages, image weight, and noindex on demo hosts. A host this machine
   cannot reach is reported as skipped, never as an outage.
4. Output a findings table (severity · check · evidence · fix · effort) and suggested regression
   tests. Append/merge into `docs/seo/SEO-BASELINE.md` → Findings when run site-wide.
5. Change nothing unless the user explicitly approves specific fixes.
6. Record state (`docs/methodology/workflow-state.md`): add new findings to the inventory's `issues[]` (see `/BWE-SEO-AUDIT` step 4);
   when a fix is made set `status: "fixed"` + `fixedOn`, and `"verified"` + `verifiedOn` once
   production shows it.
