# BWESEO Skills and Procedures

Engine Version: 1.10.0
Schema Version: 1
Last Updated: 2026-10-03

Canonical Engine:

The `SEOEngine` repository. It is located on any machine through `BWESEO_ENGINE_HOME` (the directory containing `VERSION` and
`engine-manifest.json`); where it is checked out is local configuration, not a requirement. See `docs/CLOUD-SETUP.md` for a
Claude Project or cloud thread.

BWESEO is a reusable, customer-neutral SEO engine for small-business websites. It has a state machine that reads a
project's real SEO state and recommends the next step, validators, a Google/Search Console workflow, an installer,
and a set of Claude Code skills (the `/BWESEO…` commands). It answers one question for a business: **"What
searches could bring this business a qualified customer?"** — not "what topics could generate traffic?". It is a
disciplined workflow, not an article generator, and it never mass-produces pages.

This manual is the complete operating reference: every skill, the SEO lifecycle, installing and updating the
engine, the Google workflow, live-site health, troubleshooting and engine maintenance. It contains no customer
data. Sections marked *(generated)* are produced from the engine's actual skills by `scripts/build-manual.mjs`;
do not edit them by hand — edit the source (`docs/skills-reference.json`, each `skills/<name>/SKILL.md`, or
`docs/manual-template.md`) and regenerate. `node scripts/build-manual.mjs --check` (part of
`node scripts/validate-canonical.mjs`) fails when this file is stale, a skill is undocumented, or the manual names
a skill that does not exist.

## Table of Contents

- [Quick Start](#quick-start)
- [Complete Skill Catalog](#complete-skill-catalog)
- [Command Quick Reference](#command-quick-reference)
- [Master SEO Procedure](#master-seo-procedure)
- [Adding a New SEO Page](#adding-a-new-seo-page)
- [Page-Specific /BWESEO](#page-specific-bweseo)
- [Installing BWESEO on a New Customer Website](#installing-bweseo-on-a-new-customer-website)
- [Updating BWESEO on an Existing Website](#updating-bweseo-on-an-existing-website)
- [Google Search Workflow](#google-search-workflow)
- [Live Site Health](#live-site-health)
- [SEO Opportunity Procedure](#seo-opportunity-procedure)
- [Content Creation Procedure](#content-creation-procedure)
- [Technical SEO Procedure](#technical-seo-procedure)
- [Local SEO Procedure](#local-seo-procedure)
- [Google Business Profile Procedure](#google-business-profile-procedure)
- [Monitoring Procedure](#monitoring-procedure)
- [Content Refresh Procedure](#content-refresh-procedure)
- [Troubleshooting](#troubleshooting)
- [Human Approval Gates](#human-approval-gates)
- [State Model Reference](#state-model-reference)
- [Directory Reference](#directory-reference)
- [Engine Maintenance](#engine-maintenance)
- [What Do I Run?](#what-do-i-run)

## Quick Start

### New website

1. Open the website project in Claude Code.
2. Run `/BWESEOInstall --dry-run` — shows exactly what would be installed. Changes nothing.
3. Review the plan (files to create, files preserved, adapter, `.gitignore` and `CLAUDE.md` changes, conflicts).
4. Run `/BWESEOInstall` — installs the reusable engine only.
5. Run `/BWESEOInstall --verify` — confirms the installation. Changes nothing.
6. Run `/BWESEOSetup` — discovers and asks for the customer's own facts and creates the project configuration.
7. Verify the customer profile (open questions, verified facts, environments).
8. Run `/BWESEO`.
9. Follow the state-aware recommendation.

### Existing configured website

Normally just run `/BWESEO`. It reads the project, says which environment it is describing and recommends the one
next step.

> **If you don't know what to do next, run `/BWESEO`.**

## Complete Skill Catalog *(generated)*

### BWESEO

**SKILL NAME:** `/BWESEO`

**PURPOSE:** The state-aware front door. Reads the project's real SEO state, says which environment it is describing, shows a short dashboard (with the pipeline lines) and recommends the ONE best next action and the skill that does it.

**WHEN TO USE:** Any time you open an SEO project or don't know what to do next. It is the only command you normally need to remember.

**SYNTAX:**

- `/BWESEO`
- `/BWESEO <page>`
- `/BWESEO show details`
- `/BWESEO keyword <phrase>`

**ARGUMENTS:** No argument: whole-project assessment. <page>: an inventory id (service-page), a site path (/service-page) or a full URL on this project's own production or staging host, for a page-focused assessment. "show details" / "full SEO status": the long view. `keyword <phrase>`: analyzes one Google keyword from the site's own Search Console data (not a Google search).

**EXAMPLES:**

- `/BWESEO`
- `/BWESEO /service-page`
- `/BWESEO https://example.com/service-page`
- `/BWESEO keyword "metric to imperial converter"`

**INPUTS:** The project's seo/ files and docs/seo/, the installation receipt, and read-only requests to production and staging.

**OUTPUTS:** Environment block, project stages, the current page's pipeline and steps, other pages, site issues, live-site health, the NEXT RECOMMENDED STEP with WHAT WE ARE DOING / WHY IT MATTERS / WHAT HAPPENS NEXT.

**AUTOMATIC ACTIONS:** Read-only state assessment and read-only GET requests. Records only what the owner told it (approvals, holds, indexing requests) and only with the owner's dated word.

**HUMAN APPROVAL REQUIREMENTS:** Asks "Would you like me to go ahead?" before routing to any other skill. Never skips an approval gate.

**EXTERNAL ACTIONS:** Read-only HTTP GETs to the project's production and staging sites. Nothing is submitted anywhere.

**SAFETY RULES:** Never recommends indexing actions for staging, preview or local URLs. Never lets staging status stand in for production status. A failed live-health check never changes lifecycle history. Refuses a URL that is not on the project's own hosts.

**NEXT TYPICAL STEP:** Whatever it recommends (for a new project: /BWESEOInstall, then /BWESEOSetup).

### BWESEOInstall

**SKILL NAME:** `/BWESEOInstall`

**PURPOSE:** The standard way to install, verify, update and sync the reusable BWESEO engine and its Claude skills in a website project, from the canonical engine, through an explicit allowlist manifest.

**WHEN TO USE:** A brand-new website (install), before any real install (--dry-run), after installing or updating (--verify), when the engine has a new version (--update), when installed skills drift from the canonical source (--sync-skills).

**SYNTAX:**

- `/BWESEOInstall`
- `/BWESEOInstall --dry-run`
- `/BWESEOInstall --verify`
- `/BWESEOInstall --update`
- `/BWESEOInstall --dry-run --update`
- `/BWESEOInstall --sync-skills`

**ARGUMENTS:** --dry-run (change nothing, show the plan), --verify (change nothing, report), --update (engine files only; customer data preserved), --sync-skills (install/update Claude skills from the canonical source; combine with --dry-run to preview), --json, --allow-subdir, --with-optional, --engine <dir>.

**EXAMPLES:**

- `/BWESEOInstall --dry-run`
- `/BWESEOInstall`
- `/BWESEOInstall --verify`
- `/BWESEOInstall --dry-run --update`

**INPUTS:** The canonical engine (engine-manifest.json + files) and the target website project.

**OUTPUTS:** Engine files under seo/tools, seo/schema and docs/seo; empty seo/ and seo/data/; .gitignore rules; a BWESEO-managed CLAUDE.md section; the installation receipt seo/bweseo-install.json (versions, hashes, adapter — no secrets).

**AUTOMATIC ACTIONS:** Verifies the manifest and every hash, scans the payload for secrets and other projects' identities before writing, then copies only allowlisted files. Never commits. If the website already has the engine installed, a plain /BWESEOInstall hands off to /BWESEOUpdate.

**HUMAN APPROVAL REQUIREMENTS:** A dry run is shown and approved before the first real install on a customer project. Conflicts are marked REVIEW REQUIRED and left untouched.

**EXTERNAL ACTIONS:** None. No network, deploy, commit, push, DNS or Google call.

**SAFETY RULES:** Direction is canonical engine to website only. Never modifies the canonical engine, never copies business facts, Search Console/analytics/health state, lifecycle history or credentials. Refuses rather than works around a failed gate.

**NEXT TYPICAL STEP:** /BWESEOInstall --verify, then /BWESEOSetup.

### BWESEOSetup

**SKILL NAME:** `/BWESEOSetup`

**PURPOSE:** Creates the customer-specific configuration after the engine is installed: seo-config, business profile, content inventory and docs/seo, from the owner's verified facts.

**WHEN TO USE:** Once, after /BWESEOInstall --verify, for a new customer site (or to re-verify facts later).

**SYNTAX:**

- `/BWESEOSetup`

**ARGUMENTS:** None. It asks for and discovers project-specific information.

**EXAMPLES:**

- `/BWESEOSetup`

**INPUTS:** Owner statements, a questionnaire export, the live site and admin data (read-only), deploy configuration.

**OUTPUTS:** seo/seo-config.json (environments, publication, Search Console settings), seo/business-profile.json (every fact with provenance), seo/content-inventory.json, docs/seo/ shells, registration of the project's identity for isolation scans.

**AUTOMATIC ACTIONS:** Read-only discovery of the stack, hosts and sitemap; validation of the created files.

**HUMAN APPROVAL REQUIREMENTS:** Confirms the business and site with the owner before creating anything. Unknown facts become open questions, never guesses.

**EXTERNAL ACTIONS:** Read-only requests to the site.

**SAFETY RULES:** Never copies configuration from another project, never fabricates facts, never stores credentials (a name only).

**NEXT TYPICAL STEP:** /BWESEO

### BWESEOAudit

**SKILL NAME:** `/BWESEOAudit`

**PURPOSE:** A full read-only SEO baseline audit of the site.

**WHEN TO USE:** After setup, and again when the audit is over 180 days old.

**SYNTAX:**

- `/BWESEOAudit`

**ARGUMENTS:** None.

**EXAMPLES:**

- `/BWESEOAudit`

**INPUTS:** The site's code and live pages, the profile and inventory.

**OUTPUTS:** docs/seo/SEO-BASELINE.md with Critical/High/Medium/Low findings, and site issues recorded in the inventory.

**AUTOMATIC ACTIONS:** Read-only analysis; records findings.

**HUMAN APPROVAL REQUIREMENTS:** None to run. Fixing findings needs approval.

**EXTERNAL ACTIONS:** Read-only requests.

**SAFETY RULES:** Changes nothing on the site.

**NEXT TYPICAL STEP:** /BWESEOOpportunities

### BWESEOTechnical

**SKILL NAME:** `/BWESEOTechnical`

**PURPOSE:** Technical SEO audit of the site or one page: crawl/index rules, robots groups, environment protection, sitemap, canonicals, status codes, redirects, metadata, performance.

**WHEN TO USE:** To check robots/sitemap/canonicals, or when /BWESEO routes a technical site issue.

**SYNTAX:**

- `/BWESEOTechnical`
- `/BWESEOTechnical <issue id or URL>`

**ARGUMENTS:** Optional: an inventory issue id, or a URL/route to scope the run.

**EXAMPLES:**

- `/BWESEOTechnical`
- `/BWESEOTechnical robots-agent-groups`

**INPUTS:** Source, build output and read-only requests.

**OUTPUTS:** A findings table with suggested regression tests; issues recorded in the inventory.

**AUTOMATIC ACTIONS:** Read-only checks.

**HUMAN APPROVAL REQUIREMENTS:** Any fix needs the owner's approval.

**EXTERNAL ACTIONS:** Read-only requests.

**SAFETY RULES:** Changes nothing unless specific fixes are approved.

**NEXT TYPICAL STEP:** The approved fix through the normal change process, then re-check.

### BWESEOSchema

**SKILL NAME:** `/BWESEOSchema`

**PURPOSE:** Structured-data (JSON-LD) audit: every block per page, conflicts, unsupported or fabricated properties.

**WHEN TO USE:** To check or improve structured data.

**SYNTAX:**

- `/BWESEOSchema`

**ARGUMENTS:** None.

**EXAMPLES:**

- `/BWESEOSchema`

**INPUTS:** Source and rendered pages, the verified profile.

**OUTPUTS:** Findings and recommended schema that the visible page and verified facts support.

**AUTOMATIC ACTIONS:** Read-only analysis.

**HUMAN APPROVAL REQUIREMENTS:** Changes need approval.

**EXTERNAL ACTIONS:** Read-only requests.

**SAFETY RULES:** Never recommends ratings, reviews, hours or sameAs that are not real and verified.

**NEXT TYPICAL STEP:** The approved fix, then /BWESEOQA.

### BWESEOLocal

**SKILL NAME:** `/BWESEOLocal`

**PURPOSE:** Local SEO analysis for location-dependent businesses: NAP consistency, address type, service-area honesty, location pages, Google Business Profile actions for the owner.

**WHEN TO USE:** Only when location matters to the business.

**SYNTAX:**

- `/BWESEOLocal`
- `/BWESEOLocal gbp`

**ARGUMENTS:** Optional gbp: Google Business Profile builder in manual mode.

**EXAMPLES:**

- `/BWESEOLocal`

**INPUTS:** The verified profile and the site.

**OUTPUTS:** Findings and a list of Google Business Profile actions for the owner.

**AUTOMATIC ACTIONS:** Read-only analysis.

**HUMAN APPROVAL REQUIREMENTS:** Changes need approval; Business Profile actions are the owner's.

**EXTERNAL ACTIONS:** None (owner acts in Google Business Profile).

**SAFETY RULES:** Never fabricates locations, addresses or a Business Profile.

**NEXT TYPICAL STEP:** /BWESEOOpportunities or /BWESEOContentPlan.

### BWESEOOpportunities

**SKILL NAME:** `/BWESEOOpportunities`

**PURPOSE:** Finds searches that could bring a qualified customer, maps them to verified offerings, classifies intent, scores P1/P2/P3 without invented volumes and runs the cannibalization check.

**WHEN TO USE:** After the audit, or when planning what to build next.

**SYNTAX:**

- `/BWESEOOpportunities`

**ARGUMENTS:** None.

**EXAMPLES:**

- `/BWESEOOpportunities`

**INPUTS:** Verified offerings, the existing inventory, the audit.

**OUTPUTS:** Scored opportunities with a create / improve-existing / merge / reject decision.

**AUTOMATIC ACTIONS:** Analysis only; records ideas.

**HUMAN APPROVAL REQUIREMENTS:** None to run; the owner approves which page to build.

**EXTERNAL ACTIONS:** None (web research only in /BWESEOCompetitors).

**SAFETY RULES:** Never invents keyword volumes; a keyword never establishes that the business offers a service.

**NEXT TYPICAL STEP:** /BWESEOContentPlan

### BWESEOCompetitors

**SKILL NAME:** `/BWESEOCompetitors`

**PURPOSE:** Search-results and competitor gap analysis for approved target topics.

**WHEN TO USE:** Before writing a page, or to test an opportunity.

**SYNTAX:**

- `/BWESEOCompetitors`

**ARGUMENTS:** None (asks which approved topics).

**EXAMPLES:**

- `/BWESEOCompetitors`

**INPUTS:** Approved target topics; standard web search.

**OUTPUTS:** Who ranks, page types that win, questions answered, gaps this business can honestly fill.

**AUTOMATIC ACTIONS:** Web searches.

**HUMAN APPROVAL REQUIREMENTS:** None.

**EXTERNAL ACTIONS:** Standard web search (read-only).

**SAFETY RULES:** Never copies competitor content, never invents volumes.

**NEXT TYPICAL STEP:** /BWESEOContentPlan or /BWESEOCreatePage.

### BWESEOContentPlan

**SKILL NAME:** `/BWESEOContentPlan`

**PURPOSE:** Builds the page map, pillar/cluster architecture and a prioritized roadmap, then presents the top P1 pages for approval and stops.

**WHEN TO USE:** After opportunities are scored.

**SYNTAX:**

- `/BWESEOContentPlan`

**ARGUMENTS:** None.

**EXAMPLES:**

- `/BWESEOContentPlan`

**INPUTS:** Scored opportunities and the inventory.

**OUTPUTS:** docs/seo/CONTENT-ROADMAP.md and page-map records, and an approval report.

**AUTOMATIC ACTIONS:** Planning only.

**HUMAN APPROVAL REQUIREMENTS:** The owner picks ONE page to build.

**EXTERNAL ACTIONS:** None.

**SAFETY RULES:** Never creates pages.

**NEXT TYPICAL STEP:** The owner's approval, then /BWESEOCreatePage.

### BWESEOCreatePage

**SKILL NAME:** `/BWESEOCreatePage`

**PURPOSE:** Creates exactly one owner-approved SEO page: claims ledger against verified facts, original content, metadata, schema, internal links, CTA, sitemap entry, build and tests.

**WHEN TO USE:** After the owner approves one page.

**SYNTAX:**

- `/BWESEOCreatePage <page id or URL>`

**ARGUMENTS:** The approved page's inventory id or URL. Refuses if the page is not approved in the inventory.

**EXAMPLES:**

- `/BWESEOCreatePage service-page`

**INPUTS:** The approved inventory entry and the verified profile.

**OUTPUTS:** The page's code and content, inventory updates (verifyText, linksFrom, claims) and a change report.

**AUTOMATIC ACTIONS:** Writes the page files and runs build and tests.

**HUMAN APPROVAL REQUIREMENTS:** The page must be approved by the owner first; deploying is a separate approval.

**EXTERNAL ACTIONS:** None (no deploy).

**SAFETY RULES:** One page per approval; no fabricated customers, testimonials, statistics or locations; no ranking promises.

**NEXT TYPICAL STEP:** /BWESEOQA <page>

### BWESEOInternalLinks

**SKILL NAME:** `/BWESEOInternalLinks`

**PURPOSE:** Internal-link analysis: link graph, orphan pages, broken or weak anchors, and planned links to and from each roadmap page.

**WHEN TO USE:** To fix link structure or plan links for a new page.

**SYNTAX:**

- `/BWESEOInternalLinks`

**ARGUMENTS:** None.

**EXAMPLES:**

- `/BWESEOInternalLinks`

**INPUTS:** The site's navigation, footer and body links.

**OUTPUTS:** Findings and specific link recommendations.

**AUTOMATIC ACTIONS:** Read-only analysis.

**HUMAN APPROVAL REQUIREMENTS:** Link changes need approval.

**EXTERNAL ACTIONS:** Read-only requests.

**SAFETY RULES:** Links must help visitors; never added for SEO alone.

**NEXT TYPICAL STEP:** The approved changes, then /BWESEOQA.

### BWESEOQA

**SKILL NAME:** `/BWESEOQA`

**PURPOSE:** The SEO QA gate for a page (content, on-page, technical), and with `staging` the staging review of the page on the staging site.

**WHEN TO USE:** After a page is created (QA), and once it is deployed to staging (staging review).

**SYNTAX:**

- `/BWESEOQA <page>`
- `/BWESEOQA <page> staging`

**ARGUMENTS:** <page>: an inventory id, path or URL. staging: run the staging review against the staging URL.

**EXAMPLES:**

- `/BWESEOQA service-page`
- `/BWESEOQA service-page staging`

**INPUTS:** Build and test output, the served HTML, the claims ledger against the profile.

**OUTPUTS:** A QA table with PASS/FAIL, recorded as qa (or staging.review) with a source hash; for staging, a visual checklist for the owner.

**AUTOMATIC ACTIONS:** Runs the checks and records the result.

**HUMAN APPROVAL REQUIREMENTS:** The owner's staging approval is a separate, human step and is not permission to deploy.

**EXTERNAL ACTIONS:** Read-only requests; staging is labelled SEARCH ENGINE INDEXING ACTIONS: DISABLED.

**SAFETY RULES:** Never marks visual checks PASS without evidence; never requests indexing for a staging URL.

**NEXT TYPICAL STEP:** Staging deploy, then /BWESEOQA <page> staging, then the owner's approval; after a production deploy, /BWESEOPublish.

### BWESEOPublish

**SKILL NAME:** `/BWESEOPublish`

**PURPOSE:** The mandatory post-publication check on production: live, indexable, canonical, robots, sitemap, internal links, metadata, structured data, no staging leakage; then Google readiness and the monitoring checkpoints.

**WHEN TO USE:** After the owner has deployed the page to production.

**SYNTAX:**

- `/BWESEOPublish <page id or URL>`

**ARGUMENTS:** The page's inventory id or URL. The checker classifies the environment: local is not applicable, staging runs a technical check with indexing actions disabled, production runs the full check.

**EXAMPLES:**

- `/BWESEOPublish service-page`

**INPUTS:** The inventory entry, seo-config, and read-only production requests.

**OUTPUTS:** A report in docs/seo/reports, the inventory update (published status, Google readiness, monitoring dates) and the exact manual Search Console steps.

**AUTOMATIC ACTIONS:** Runs the read-only checker and records the result.

**HUMAN APPROVAL REQUIREMENTS:** None to run. Requesting indexing is the owner's manual action.

**EXTERNAL ACTIONS:** Read-only requests. Never deploys, never requests indexing.

**SAFETY RULES:** PUBLISHED does not mean DISCOVERED or INDEXED. Staging never counts as production.

**NEXT TYPICAL STEP:** /BWESEOSearchConsole

### BWESEOSearchConsole

**SKILL NAME:** `/BWESEOSearchConsole`

**PURPOSE:** The Google side: idempotent sitemap registration through the official Search Console API, page discovery/crawl/index status through the URL Inspection API, performance analysis and the 7/30/90-day reviews. Also reads the site's Google Index Monitoring snapshot (which production URLs are indexed, which need attention, how long new pages typically take). Also answers, per registered keyword, which page is meant to rank, whether Google has indexed it (confirmed / inferred / unknown), whether Google shows it, and how it performs, with wrong-page and cannibalization detection and discovered queries.

**WHEN TO USE:** After publication, at each review date, or to check whether a page is indexed.

**SYNTAX:**

- `/BWESEOSearchConsole`
- `/BWESEOSearchConsole index pull`
- `/BWESEOSearchConsole index status`
- `/BWESEOSearchConsole index investigate`
- `/BWESEOSearchConsole index explain <path>`
- `/BWESEOSearchConsole index impressions`
- `/BWESEOSearchConsole keywords pull`
- `/BWESEOSearchConsole keywords status`
- `/BWESEOSearchConsole keywords analyze <keyword>`
- `/BWESEOSearchConsole keywords discovered`
- `/BWESEOSearchConsole keywords add <page-id> <keyword>`

**ARGUMENTS:** None, or `index pull|status|investigate|impressions|explain <path>` for the Google Index Monitoring snapshot. `keywords add|remove|list|validate|pull|refresh|status|analyze|table|page|discovered|investigate` for the Keyword Performance System (which page is meant to rank for a keyword, whether Google indexed it and shows it, and how it performs — from the site's own Search Console data).

**EXAMPLES:**

- `/BWESEOSearchConsole`
- `/BWESEOSearchConsole index investigate`
- `/BWESEOSearchConsole index explain /word-counter`
- `/BWESEOSearchConsole keywords analyze "metric to imperial converter"`
- `/BWESEOSearchConsole keywords discovered`

**INPUTS:** The project's Search Console configuration, an optional API credential (by name), or the owner's exports in seo/data/search-console/. For index monitoring: the site's own monitor data, pulled to seo/data/google-index/ with the developer's wrangler login. For keywords: pages[].keywords in seo/content-inventory.json and the site's stored keyword data, pulled to seo/data/keyword-performance/.

**OUTPUTS:** Site-level sitemap record, page-level discovered/crawled/indexed records each with evidence, performance summaries, a Search Console report. An indexing status (Search Console, Sitemap, Indexing, indexing rate), per-URL explanations with Google's own evidence, and an indexing timeline. A keyword analysis (status, why, next action), a keyword table, page view and discovered-query list.

**AUTOMATIC ACTIONS:** Read-only URL Inspection and Search Analytics reads when the API is enabled. Sitemap registration only after the owner agrees.

**HUMAN APPROVAL REQUIREMENTS:** Sitemap registration needs the owner's yes. Adding, replacing or removing a registered keyword needs the owner's yes.

**EXTERNAL ACTIONS:** Official Search Console API calls (sitemaps, URL Inspection, Search Analytics) when enabled. `index pull` reads the production KV with the developer's own wrangler login (read-only). `keywords refresh` calls Search Analytics for production only (cached; cooldown and daily ceiling); `keywords pull` reads the production KV.

**SAFETY RULES:** Never simulates Request Indexing, never uses the Indexing API for ordinary pages, production URLs only, credentials never stored in the repo, indexed is only ever set from Google's own report.

**NEXT TYPICAL STEP:** /BWESEORefresh or /BWESEOReport.

### BWESEORefresh

**SKILL NAME:** `/BWESEORefresh`

**PURPOSE:** Finds published pages that need updating (stale facts, weak performance, broken links, changed intent) and produces a prioritized refresh queue.

**WHEN TO USE:** After a review, or on a periodic content review.

**SYNTAX:**

- `/BWESEORefresh`
- `/BWESEORefresh <page id>`

**ARGUMENTS:** Optional: one page id.

**EXAMPLES:**

- `/BWESEORefresh`
- `/BWESEORefresh service-page`

**INPUTS:** The profile, the inventory, Search Console data and analytics where present.

**OUTPUTS:** A refresh queue with evidence for each item.

**AUTOMATIC ACTIONS:** Analysis only.

**HUMAN APPROVAL REQUIREMENTS:** Substantial changes to a live page need approval.

**EXTERNAL ACTIONS:** None.

**SAFETY RULES:** Recommended only on evidence; never rewrites a page just to create activity or artificial freshness.

**NEXT TYPICAL STEP:** The approved changes, then /BWESEOQA.

### BWESEOReport

**SKILL NAME:** `/BWESEOReport`

**PURPOSE:** A plain-language SEO progress and performance report with honest data caveats.

**WHEN TO USE:** Monthly, or to answer how SEO is doing.

**SYNTAX:**

- `/BWESEOReport`

**ARGUMENTS:** None.

**EXAMPLES:**

- `/BWESEOReport`

**INPUTS:** The inventory, Search Console data, analytics conversions.

**OUTPUTS:** A report in docs/seo/reports with what shipped, results, pages to refresh and next month's plan.

**AUTOMATIC ACTIONS:** Read-only analysis.

**HUMAN APPROVAL REQUIREMENTS:** None.

**EXTERNAL ACTIONS:** None.

**SAFETY RULES:** Weighs qualified business conversions over vanity traffic; never invents data.

**NEXT TYPICAL STEP:** /BWESEORefresh or /BWESEO.

### BWESEOUpdate

**SKILL NAME:** `/BWESEOUpdate`

**PURPOSE:** Updates the BWESEO engine and its Claude skills in the current website to the latest canonical engine version in one guided pass: pull the engine checkout, preview, apply, sync skills, verify.

**WHEN TO USE:** When the engine has a new version and you want this website brought up to date without running the individual /BWESEOInstall modes yourself.

**SYNTAX:**

- `/BWESEOUpdate`

**ARGUMENTS:** None. It works on the current website project and asks before applying.

**EXAMPLES:**

- `/BWESEOUpdate`

**INPUTS:** The canonical engine (a Git checkout is pulled fast-forward only when clean) and this website's installation receipt.

**OUTPUTS:** Updated engine files under seo/tools and seo/schema, a refreshed receipt and managed CLAUDE.md section, synced Claude skills, and a before/after version report. Changes are left uncommitted.

**AUTOMATIC ACTIONS:** Runs --dry-run --update, --update, --sync-skills and --verify through the installer; schema migrations back up and roll back on failure.

**HUMAN APPROVAL REQUIREMENTS:** The dry-run plan is shown and approved before applying. Conflicts are marked REVIEW REQUIRED and left untouched.

**EXTERNAL ACTIONS:** None except a fast-forward git pull of the engine checkout. No deploy, commit, push, DNS or Google call.

**SAFETY RULES:** Never touches the website's SEO data, profile, configuration or inventory; never overwrites customer-modified files; refuses rather than works around a failed gate.

**NEXT TYPICAL STEP:** /BWESEO

## Command Quick Reference *(generated)*

| Command | Purpose | Typical Usage | Arguments | Human Approval? | External Effect? |
|---|---|---|---|---|---|
| `/BWESEO` | The state-aware front door. | `/BWESEO` | `<page>` · `show details` · `keyword <phrase>` | Asks before routing | None (read-only GETs) |
| `/BWESEOInstall` | The standard way to install, verify, update and sync the reusable BWESEO engine and its Claude skills in a website project, from the canonical engine, through an explicit allowlist manifest. | `/BWESEOInstall --dry-run` | `--dry-run` · `--verify` · `--update` · `--dry-run --update` · `--sync-skills` | Dry run first; conflicts need the owner | None (writes engine files to the project) |
| `/BWESEOSetup` | Creates the customer-specific configuration after the engine is installed: seo-config, business profile, content inventory and docs/seo, from the owner's verified facts. | `/BWESEOSetup` | none | Confirms the target and facts | None (read-only requests) |
| `/BWESEOAudit` | A full read-only SEO baseline audit of the site. | `/BWESEOAudit` | none | No (read-only) | None |
| `/BWESEOTechnical` | Technical SEO audit of the site or one page: crawl/index rules, robots groups, environment protection, sitemap, canonicals, status codes, redirects, metadata, performance. | `/BWESEOTechnical` | `<issue id or URL>` | Fixes only | None |
| `/BWESEOSchema` | Structured-data (JSON-LD) audit: every block per page, conflicts, unsupported or fabricated properties. | `/BWESEOSchema` | none | Fixes only | None |
| `/BWESEOLocal` | Local SEO analysis for location-dependent businesses: NAP consistency, address type, service-area honesty, location pages, Google Business Profile actions for the owner. | `/BWESEOLocal` | `gbp` | Fixes only | None |
| `/BWESEOOpportunities` | Finds searches that could bring a qualified customer, maps them to verified offerings, classifies intent, scores P1/P2/P3 without invented volumes and runs the cannibalization check. | `/BWESEOOpportunities` | none | No (owner approves pages later) | None |
| `/BWESEOCompetitors` | Search-results and competitor gap analysis for approved target topics. | `/BWESEOCompetitors` | none | No | Web search only |
| `/BWESEOContentPlan` | Builds the page map, pillar/cluster architecture and a prioritized roadmap, then presents the top P1 pages for approval and stops. | `/BWESEOContentPlan` | none | Yes (which page) | None |
| `/BWESEOCreatePage` | Creates exactly one owner-approved SEO page: claims ledger against verified facts, original content, metadata, schema, internal links, CTA, sitemap entry, build and tests. | `/BWESEOCreatePage service-page` | `<page id or URL>` | Yes (page approval) | None |
| `/BWESEOInternalLinks` | Internal-link analysis: link graph, orphan pages, broken or weak anchors, and planned links to and from each roadmap page. | `/BWESEOInternalLinks` | none | Changes only | None |
| `/BWESEOQA` | The SEO QA gate for a page (content, on-page, technical), and with `staging` the staging review of the page on the staging site. | `/BWESEOQA service-page` | `<page>` · `<page> staging` | Staging approval is the owner's | None (read-only) |
| `/BWESEOPublish` | The mandatory post-publication check on production: live, indexable, canonical, robots, sitemap, internal links, metadata, structured data, no staging leakage; then Google readiness and the monitoring checkpoints. | `/BWESEOPublish service-page` | `<page id or URL>` | No (read-only) | None (read-only) |
| `/BWESEOSearchConsole` | The Google side: idempotent sitemap registration through the official Search Console API, page discovery/crawl/index status through the URL Inspection API, performance analysis and the 7/30/90-day reviews. | `/BWESEOSearchConsole` | `index pull` · `index status` · `index investigate` · `index explain <path>` · `index impressions` · `keywords pull` · `keywords status` · `keywords analyze <keyword>` · `keywords discovered` · `keywords add <page-id> <keyword>` | Sitemap registration | Search Console API (when enabled) |
| `/BWESEORefresh` | Finds published pages that need updating (stale facts, weak performance, broken links, changed intent) and produces a prioritized refresh queue. | `/BWESEORefresh` | `<page id>` | Page changes | None |
| `/BWESEOReport` | A plain-language SEO progress and performance report with honest data caveats. | `/BWESEOReport` | none | No | None |
| `/BWESEOUpdate` | Updates the BWESEO engine and its Claude skills in the current website to the latest canonical engine version in one guided pass: pull the engine checkout, preview, apply, sync skills, verify. | `/BWESEOUpdate` | none | Dry run first; conflicts need the owner | None (writes engine files to the project) |

## Master SEO Procedure

```
Opportunity identified
        ↓
Intent/research
        ↓
Cannibalization check
        ↓
Human approval
        ↓
Content plan
        ↓
Page creation
        ↓
QA
        ↓
Staging
        ↓
Staging review
        ↓
Human approval
        ↓
Production
        ↓
Post-publication QA
        ↓
Google readiness
        ↓
Sitemap verification
        ↓
Google discovery
        ↓
Google crawl
        ↓
Google indexing
        ↓
Monitoring
        ↓
Performance review
        ↓
Refresh/improvement
```

1. **Opportunity identified** (`/BWESEOOpportunities`). Searches that could bring a *qualified* customer are mapped to
   offerings the business really has (a verified profile fact — a keyword never establishes that a business offers
   something).
2. **Intent/research.** Each opportunity gets an intent class (commercial, service, local, comparison,
   problem/solution, informational). `/BWESEOCompetitors` looks at who ranks and what is missing, using standard web
   search only.
3. **Cannibalization check.** Before anything is created, decide create / improve-existing / merge / reject.
   Improving an existing page beats adding a competing one.
4. **Human approval.** The owner approves **one** page. Nothing is built without it.
5. **Content plan** (`/BWESEOContentPlan`). The roadmap and page map; it stops at the approval report.
6. **Page creation** (`/BWESEOCreatePage <page>`). One approved page: claims ledger against verified facts, original
   content, metadata, schema, internal links, CTA, sitemap entry.
7. **QA** (`/BWESEOQA <page>`). Content, on-page and technical checks. A blocking failure fails QA.
8. **Staging.** Deployed through the project's own staging workflow (only when the project has staging).
9. **Staging review** (`/BWESEOQA <page> staging`). Function, SEO, environment (hidden from search engines) and content
   checks with indexing actions disabled; visual checks are listed for the owner.
10. **Human approval.** The owner looks at the page on staging (desktop and phone). Approving on staging is *not*
    permission to deploy.
11. **Production.** Only on the owner's explicit go, through the project's own deployment workflow.
12. **Post-publication QA** (`/BWESEOPublish <page>`). Live, HTTPS, indexable, canonical, robots, sitemap, internal
    links, metadata, structured data, no staging URLs anywhere in production output.
13. **Google readiness.** Recorded from the checks: is the page technically able to be discovered and indexed?
14. **Sitemap verification.** Membership of the production sitemap (page level) and registration of the sitemap
    with Search Console (site level).
15. **Google discovery → crawl → indexing** (`/BWESEOSearchConsole`). Three separate facts, each with its own date
    and evidence.
16. **Monitoring.** Review checkpoints at 7, 30 and 90 days after publication.
17. **Performance review.** Impressions, clicks, CTR, position, queries and — most important — qualified conversions.
18. **Refresh/improvement** (`/BWESEORefresh`). Only on evidence.

A project without a staging site skips steps 8–10 and goes from QA to the owner's production approval.

## Adding a New SEO Page

Start with **`/BWESEO`** — it is state-aware, so it knows whether the site is set up, which page is next and which
step that page is on. The examples use a fictional business, *Acme Plumbing* (`acme-plumbing.example`).

1. **Ask for the state.** `/BWESEO`. If no opportunity is approved it shows the roadmap and asks which **one** to
   build (for example "Water heater repair", `/water-heater-repair`). Approve one. It is recorded as approved by
   you, with the date.
2. **Create.** `/BWESEO` recommends `/BWESEOCreatePage water-heater-repair`. It rechecks cannibalization, builds a
   claims ledger (every factual statement mapped to a verified profile fact), writes the page in the site's own
   design, adds metadata, schema, internal links, the CTA and the sitemap entry, and runs build and tests. It does
   not deploy.
3. **QA.** `/BWESEOQA water-heater-repair`. Fixes are made until it passes. The result is recorded against the
   page's exact source (a later edit asks for QA again).
4. **Staging.** Deploy through the project's staging workflow, then `/BWESEOQA water-heater-repair staging`.
5. **Review and approve.** You open the staging URL, check desktop and phone, and say it is approved.
6. **Production.** You say *go*. The project's normal release process deploys it.
7. **Publish check.** `/BWESEOPublish water-heater-repair`.
8. **Google.** The owner performs the optional manual steps (below); `/BWESEOSearchConsole` records discovery, crawl
   and index status only from Google's own evidence.
9. **Monitor.** `/BWESEO` says "wait" until the 7-day review is due and never invents work.

Run `/BWESEO` again after every step; it always shows the current state and the next step.

## Page-Specific /BWESEO

```
/BWESEO
/BWESEO /service-page
/BWESEO https://example.com/service-page
```

A page argument gives the same assessment focused on one page: identity, environment, lifecycle (recorded
history), live health, the Google stages, and the next step for that page — and, if it differs, what the
project-wide next step is.

- **What it accepts:** an inventory id, a site path, or an absolute URL.
- **URL normalization:** query strings (`?x=1`) and fragments (`#top`) are ignored; trailing slashes are ignored;
  a path without a leading slash is treated as an inventory id.
- **Project-domain validation:** a full URL must be on the project's own production or staging host (a `www.` variant
  is accepted). A URL on any other domain is refused — "nothing is assessed for other sites" — and nothing is
  silently assessed.
- **Staging behavior:** a staging URL is accepted and resolves to the same page. The assessment then reports the
  environment as staging, and indexing actions stay disabled.
- **Unknown pages:** a page that is not in the project's SEO inventory is reported as not found (nothing is guessed),
  with the pointer to run `/BWESEO` with no argument.

## Installing BWESEO on a New Customer Website

The engine is installed **from the canonical engine to the website — never the other way round**. Installation and
onboarding are separate: `/BWESEOInstall` installs software; `/BWESEOSetup` records the customer's facts.

| Step | Command | What it does | Safety boundary |
|---|---|---|---|
| 1 | `/BWESEOInstall --dry-run` | Locates and verifies the canonical engine and its manifest, scans the payload, detects the framework, and prints everything it would do | Changes nothing — not the project and not the engine |
| 2 | `/BWESEOInstall` | Installs the allowlisted engine files (tools, schemas, generic tests, generic docs), creates empty `seo/`, `seo/data/`, `docs/seo/`, adds `.gitignore` rules, adds a BWESEO-managed section to `CLAUDE.md`, writes the receipt | Only allowlisted files; secrets and other projects' identities abort the install; never commits |
| 3 | `/BWESEOInstall --verify` | Checks the receipt, versions, manifest hashes, required files and skills, and the installed engine for leakage | Changes nothing |
| 4 | `/BWESEOSetup` | Creates the customer-specific configuration and business profile from the owner's verified facts | Asks; never copies from another project; credentials are a name only |
| 5 | `/BWESEO` | The state-aware assessment and the next step | Read-only |

After a successful install the installer says: *BWESEO engine installed successfully. No customer-specific SEO
profile exists yet. Next recommended action: `/BWESEOSetup`.* A framework with no shipped adapter installs the core
only and reports "Website adapter requires configuration" — no adapter is invented.

## Updating BWESEO on an Existing Website

```
/BWESEOInstall --dry-run --update
/BWESEOInstall --update
/BWESEOInstall --verify
```

`--update` changes the reusable **engine** only. It **always preserves**:

- the customer profile and configuration
- the SEO inventory and content inventory
- lifecycle, deployment and health history
- Search Console, Google and analytics state
- keyword and competitor research, the content roadmap, monitoring history
- customer-specific documentation and reports

A schema migration (when the schema version changes): the relevant state is backed up, migrated, validated, existing
values are preserved, missing values are **never fabricated**, and a failed migration rolls everything back. A
file the customer changed since installing is a conflict — **REVIEW REQUIRED**, left untouched, never overwritten.

`/BWESEOInstall --sync-skills` (with `--dry-run` to preview) installs or updates the Claude skills from the
canonical source; a skill edited by hand is reported as a conflict and never overwritten.

## Google Search Workflow

```
Search Console setup → Google readiness → sitemap membership → sitemap submission
→ Live URL Test → manual Request Indexing → Google discovery → Google crawl → Google indexing
→ monitoring → performance
```

**PUBLISHED ≠ DISCOVERED**
**DISCOVERED ≠ CRAWLED**
**CRAWLED ≠ INDEXED**
**INDEXING REQUESTED ≠ INDEXED**
**SITEMAP SUCCESS ≠ INDEXED**
**LIVE URL TEST PASSED ≠ INDEXED**

Each stage is recorded on its own, with its own date and source. No stage implies the next, and **Google Indexed is
never recorded without reliable evidence** (Google's own report).

| Stage | Level | What it is | Automated? |
|---|---|---|---|
| Search Console configured | Site | The property exists and who owns it | No — the owner sets it up; the engine records it |
| Sitemap registration | Site | The sitemap is registered with Search Console | Yes, through the official API, idempotently, only when enabled and the owner agrees |
| Google readiness | Page | The page is technically able to be discovered and indexed (live, indexable, canonical, robots, sitemap) | Yes (`/BWESEOPublish`) |
| Sitemap membership | Page | The page's URL is in the production sitemap (with a sensible `lastmod`) | Yes |
| Live URL Test | Page | The owner's manual test in Search Console | No — manual, optional |
| Request Indexing | Page | The owner's manual button click | **No — never simulated** |
| Google discovered | Page | Google knows the URL | Read-only via the URL Inspection API when enabled; otherwise the owner reports it |
| Google crawled | Page | Google fetched it | Same |
| Google indexed | Page | The URL is on Google | Same — set **only** from Google's own report |
| Monitoring / performance | Page | Impressions, clicks, CTR, position, queries, conversions | API or the owner's exports; zero is valid |

**What can be automated:** readiness, robots/canonical/sitemap verification, `lastmod` checks, internal links,
Search Console *sitemap* operations, URL Inspection reads, performance reads. **What stays manual:** the Live URL
Test and Request Indexing buttons. The engine never automates or imitates them through unsupported means, and it
never uses Google's **Indexing API** for ordinary service or content pages (`indexingApiEligible` defaults to
`false`; that API is only for the page types Google supports it for).

**Credentials** are never stored in the repository, the inventory, client code, logs or an admin card: the config
holds only the *name* of an environment variable or secret. If the API is not enabled the rest of the workflow
still works and the owner's manual steps are shown.

## Live Site Health

Two independent models:

- **SEO LIFECYCLE STATE** — the historical workflow truth: approved, created, QA passed, staging, production,
  post-publication checked, Google stages. It changes only when something real happens (a deployment, a check, the
  owner's word).
- **LIVE SITE HEALTH** — a current availability observation: "can I reach the page right now?".

> **A failed availability check must never automatically reverse a completed lifecycle milestone.**

Example: Production ✓, Post-publication ✓, Search Console ✓, Indexing requested ✓ can coexist with
`Live Site Health: ⚠ Production check unavailable — HTTP 522`. The lifecycle stays as it was.

| Observation | Classified as | What it means | What happens |
|---|---|---|---|
| 200 | ok | Reachable | Healthy |
| 301 / 302 | redirected | The URL answers elsewhere | Reported; an unexpected redirect of a published page is investigated |
| 404 / 410 | missing | The page is currently missing | An **investigation warning** ("the records say published but the page is missing"). History is not erased; nothing is republished automatically |
| 429, 500, 502, 503, 504 | unavailable | The site or a limiter is refusing right now | Health is degraded/unavailable; lifecycle unchanged |
| Cloudflare 52x (e.g. 522) | unavailable | The edge could not reach the origin | Same |
| Timeout, DNS failure, connection failure | unavailable | Nothing answered | Same |

Transient failures get one retry; consecutive failures are counted (after three, health escalates from "check
failed" to "unavailable"). A **skipped** check is `UNKNOWN`, never a failure. Health records (status, checked URL,
time, response time, error type, consecutive failures, last success) live apart from lifecycle history. Health failures
never trigger republishing, sitemap resubmission or any Google state change. A **verified rollback** is different: it
is recorded explicitly as a production reversal by a person or a deployment record, not inferred from a failed probe.

The check itself is configurable (`environments.health.strategy`: run in the owner's browser, on the server with a
guard, or off). A server or edge function must not blindly fetch its own hostname — that is unreliable on some hosts
— so the engine records the risk and prefers an independent probe. Provider-specific behavior belongs in the
website adapter, not the core.

## SEO Opportunity Procedure

1. **Search intent** — what is the person trying to do? (commercial, service, local, comparison, problem/solution,
   informational)
2. **Business relevance** — does the business verifiably offer this, in this place, at a price it will stand behind?
3. **Commercial intent** — would a person searching this plausibly become a qualified customer?
4. **Existing-page analysis** — is there already a page that should be improved instead?
5. **Cannibalization** — would a new page compete with an existing one? (create / improve-existing / merge / reject)
6. **Competition** — what do the ranking pages do, and what is honestly missing? (`/BWESEOCompetitors`)
7. **Local relevance** — does the location claim match verified service areas?
8. **Prioritization** — P1 / P2 / P3 by customer value, effort and risk.
9. **Human approval** — the owner approves one page at a time.

Do not invent exact keyword volumes. Use qualitative scoring unless the owner supplies real data.

## Content Creation Procedure

1. **Research** the intent and the competitors' gaps.
2. **Fact verification** — every claim maps to a verified profile fact; unknowns become open questions.
3. **Outline** the page around what the visitor needs first.
4. **Original content** in the business's voice.
5. **Intent matching** — the answer appears early; the page satisfies the search.
6. **CTA** — one clear conversion path from the profile's primary goal.
7. **Metadata** — unique title and description.
8. **Schema** — only what the visible page and verified facts support.
9. **Internal links** — from relevant pages and to related pages, useful to visitors.
10. **Sitemap** — the page is registered.
11. **QA** — `/BWESEOQA`.

**Never:** keyword stuffing; doorway pages; mass-produced thin pages; fabricated customers, testimonials, reviews,
statistics, awards or locations; ranking guarantees ("#1 on Google", "rank in 24 hours"); copying competitors.

## Technical SEO Procedure

`/BWESEOTechnical` (site or one page) checks: titles, meta descriptions, canonical, robots (including per-agent
groups — a crawler obeys only its most specific group), sitemap, noindex, structured data, Open Graph, image alt
text, internal links, broken links, orphan pages, duplicates, thin content, mobile, accessibility, performance and
indexability — and environment protection: production is indexable, staging and preview are hidden from search
engines (a noindex header or sign-in is strong; robots.txt alone is weak), and no staging, preview or localhost URL
appears in production canonicals, sitemaps, links, schema or social metadata. Findings are read-only; fixes go
through approval.

The reusable page checks (`seo-page-checks.mjs`, also run by `/BWESEOPublish` and the staging review) add: `og:url` vs canonical,
declared vs real social-image size, H1 visible in the server HTML (no `opacity:0` until JavaScript), a shared navigation and footer on
every public sub-page, and dead `#anchors` in the navigation/footer. Each is ✓ pass, ✗ fail (reliably established), ? **REVIEW REQUIRED**
(uncertain — a person looks) or – skip (not enough information; e.g. a remote image is never fetched).

## Local SEO Procedure

`/BWESEOLocal` (only for location-dependent businesses) reviews: business identity, service areas, location claims,
structured data, local intent, **Google Business Profile verification** (an owner action), address handling
(storefront vs service-area vs mailing), and NAP (name, address, phone) consistency where applicable. **Never
fabricate locations or a Business Profile.** Location pages are kept, improved, merged or retired based on real
service, avoiding doorway-page patterns.

## Google Business Profile Procedure

`/BWESEOLocal gbp` (developer tool: `node seo/tools/seo-local-gbp.mjs`) helps an eligible business connect or create its Google Business
Profile and keep it complete. It runs in **manual mode**: it needs no Google access, makes no network call, and never changes the website or
Google. Creating, verifying and editing the profile, posting replies and posts happen in Google's own interface, by the owner. Google
Business Profile API access (OAuth, live sync, live reviews and posts, API performance data) is **not built yet** and needs Google's approval;
until then those features are reported as unavailable, never as working.

Everything it records lives in the website's own private `seo/data/local-gbp/` folder (git-ignored), so every client is isolated.

**Steps, in order**

1. **Eligibility** — `questions`, then `eligibility --answers answers.json --by "<name>"`. The administrator answers: serves customers in person,
   staffed location, travels to customers, online-only, legitimate address and its type, existing profile, owner authorisation. Nothing is
   inferred from marketing copy. Result: storefront, service-area, hybrid or online-only. Online-only businesses, PO boxes, virtual offices and
   unstaffed shared spaces are refused, and the tool lists website-SEO alternatives instead. A service-area business keeps a real address but hides it.
2. **Existing profile** — look the business up in Google Search or Maps (no scraping), then
   `discover --method "<where>" --by "<name>" [--candidates c.json]`. Likely or exact matches block creation until each is resolved with
   `discover --resolve <key> --resolution connect-existing|claim|different-business|ignore-possible --reason "<why>" --by "<name>"`.
   The tool never suggests creating a second profile to get around a claimed one.
3. **Draft** — `draft --init` builds a draft from the *verified, public* facts in `seo/business-profile.json` and a plain description from them.
   Edit `seo/data/local-gbp/draft.json`: description, categories (chosen from Google's own list), structured hours, special hours, address, images.
   The name must be the real business name — no keywords, locations or "best/cheap".
4. **Check** — `check` shows readiness, errors, warnings, the completeness checklist (an internal score, not a Google ranking factor; items only visible
   in Google's interface are marked unknown) and **USER INPUT NEEDED**.
5. **Website** — `schema` prints LocalBusiness JSON-LD (never a hidden address, never invented ratings); `audit --html page.html` compares name, phone,
   address, hours and structured data with the profile.
6. **Approve and create** — `approve --by "<name>"` records who approved the exact draft (a later edit voids it). Only when eligibility, the
   existing-profile search, validation and approval all hold, `created --by "<name>"` records that the owner created it in Google's interface.
   It is recorded as *reported by the administrator*, not confirmed by Google.
7. **Verification** — `verification --status pending-owner-action --method postcard --by "<name>"` records the owner-reported status and shows what the owner
   must do. Google decides which methods exist; none is promised and verification is never bypassed.

**Improvement queue, reviews, posts and performance**

- `recommend` queues improvements (each with current value, proposed value, reason, evidence, expected benefit, confidence and approval status).
  Work them with `queue --move <id> --to review|approved|implementing|verification|completed|rejected|deferred|failed --by "<name>"`. Approval needs a
  name; completing needs evidence. `queue --sync` copies them into the site's normal improvement queue (`issues[]`, area local). Rejected items are not
  suggested again.
- `reviews --import reviews.json --by "<name>"` brings in reviews you copied from Google; `--unanswered` lists them by priority; `--draft <id>` writes a
  reply that avoids private details and promises; `--approve <id> --by "<name>"` approves it; post it yourself, then `--posted <id>`.
  `review-request` gives neutral wording for asking customers for reviews: no rewards, no only-happy-customers, no requests for a rating.
- `posts --suggest` proposes topics only from recently published pages; `--add post.json`, `--approve <id>`, `--schedule <id> --when YYYY-MM-DD` and
  `--posted <id>` track a post. The engine never publishes; a schedule is an intended date.
- `performance --import figures.csv --by "<name>"` records figures you copied from the Business Profile interface (calls, website clicks, directions,
  search views, messages, bookings). It shows 7, 28 and 90-day totals with change against the previous period, marks anything not imported as
  unavailable, estimates nothing, and keeps these figures apart from Search Console.

`status` shows the mode (manual), where the business stands, the one next action and what is unavailable without Google access.

**Never:** invent a storefront, address, service, category, photo or review; use a virtual office or PO box; add keywords to the business name;
create doorway pages; offer rewards for reviews; post or reply without a named approver; say Google verified or published something it has not.

## Monitoring Procedure

The engine schedules review checkpoints from the publication date:

| Checkpoint | Look at |
|---|---|
| 7 days | Has Google discovered / indexed the page (where data exists)? Technical problems? |
| 30 days | Impressions, queries, clicks, CTR, average position; internal-link opportunities; does the intent still fit? |
| 90 days | A real performance review: which queries, what trend, traffic, conversions, content gaps; expand, revise, consolidate, or leave alone |

Measures: impressions, clicks, CTR, average position, queries, landing pages, conversions. A page can have zero data
early — that is valid, not a failure. **Qualified business conversions matter more than vanity traffic.** These are
review checkpoints, not promises that meaningful data will exist. Run them with `/BWESEOSearchConsole`; summarize
with `/BWESEOReport`.

## Content Refresh Procedure

`/BWESEORefresh` builds a refresh queue **only from evidence**: performance review, query changes, content decay,
new opportunities, outdated facts or prices (against the verified profile), internal-link improvements, metadata
improvements, conversion improvements. It never creates artificial freshness or rewrites a page just because it has
not ranked quickly.

## Troubleshooting

### Page not indexed
- **Symptom:** the page is live but Google reports it is not on Google.
- **Likely causes:** too new; not discovered yet; noindex or a robots block; canonical points elsewhere; thin or duplicate content; not in the sitemap.
- **Diagnose:** `/BWESEO <page>`, then `/BWESEOPublish <page>` (readiness), then `/BWESEOSearchConsole` (URL Inspection evidence).
- **Command/skill:** `/BWESEOPublish`, `/BWESEOSearchConsole`, `/BWESEOTechnical`.
- **Do not:** mark it indexed without Google's evidence; spam Request Indexing; rewrite the page just because it is new.

### Page not discovered
- **Symptom:** Google has not found the URL.
- **Likely causes:** not in the sitemap; orphaned (no internal links); sitemap not registered; blocked.
- **Diagnose:** check membership and inbound links in `/BWESEOPublish`; check the sitemap registration in `/BWESEOSearchConsole`.
- **Do not:** assume "sitemap success" means the page is discovered.

### Sitemap missing a URL
- **Symptom:** a published page is not in the production sitemap.
- **Likely causes:** the page is not in the site's page registry; a cache; a build did not include it.
- **Diagnose:** `/BWESEOPublish <page>` (sitemap check); fix the registry (a site change — needs approval).
- **Do not:** resubmit the sitemap repeatedly; add staging URLs.

### Sitemap error
- **Symptom:** Search Console reports errors for the sitemap.
- **Likely causes:** invalid XML; wrong host; unreachable; blocked.
- **Diagnose:** `/BWESEOTechnical`; `/BWESEOSearchConsole` reads the status. Resubmission happens only when Google reports errors (or on request).

### Production 404
- **Symptom:** a page recorded as published returns 404/410.
- **Likely causes:** a deploy removed it; a route changed; a rollback.
- **Diagnose:** `/BWESEO <page>` shows an investigation warning and keeps the history. Check the deployment record.
- **Do not:** republish automatically; erase the page's history.

### Production 522, timeout or other temporary failure
- **Symptom:** live health says unavailable (HTTP 522, 5xx, timeout, DNS).
- **Likely causes:** the edge cannot reach the origin; an outage; a rate limit.
- **Diagnose:** retry later; check the hosting status. Lifecycle history is untouched.
- **Do not:** treat it as a failed publication; republish; change Google state; resubmit the sitemap.

### Incorrect canonical
- **Symptom:** the canonical points to another page or host.
- **Diagnose:** `/BWESEOPublish <page>` (critical if it points to staging); `/BWESEOTechnical`.
- **Do not:** submit the page for indexing until it is fixed.

### og:url differs from the canonical / wrong social image size
- **Symptom:** `/BWESEOPublish` or `/BWESEOQA <page> staging` shows `✗ og:url matches the canonical URL` or `✗ Social image dimensions`.
- **Cause:** usually a site-wide `og:url` (or image size) hard-coded in the root layout that a page didn't override.
- **Fix:** generate canonical, `og:url` and the social tags from one shared page-metadata helper; make declared image dimensions equal the
  file's real size (see the stack adapter). **Do not** "fix" it by widening the comparison.

### Hero or navigation problems found by the page checks
- **Symptom:** `✗ Above-the-fold content visible` (H1 hidden until JavaScript), `✗ Site navigation present`, `✗ Navigation and footer anchors`.
- **Fix:** render the hero plainly in the server HTML; put the shared header/footer on every public page; use `/#section` links on sub-pages.
  `? REVIEW REQUIRED` items need a human look — they are not defects until confirmed.

### Robots blocking a page
- **Diagnose:** `/BWESEOTechnical` (per-agent groups), `/BWESEOPublish`. **Do not** rely on robots.txt alone to hide staging.

### Noindex on production
- **Symptom:** an intended public page says noindex. **This is a critical error.**
- **Likely cause:** a staging-only setting reached production. Production indexability is verified on production itself, never inferred from staging.
- **Command:** `/BWESEOTechnical`. **Do not** request indexing until fixed.

### Search Console API unavailable
- **Symptom:** the API reports disabled, credential missing or network error.
- **What still works:** readiness, sitemap membership and the owner's manual steps and exports.
- **Diagnose:** `seo-google.mjs api-status` (booleans only). **Do not** paste a credential into the repo or chat.

### Search Console permissions failure
- **Symptom:** permission-denied.
- **Cause:** the service account is not a user of the property.
- **Fix:** the owner adds it in Search Console. **Do not** widen permissions beyond what is needed.

### Analytics unavailable
- **Symptom:** no conversion data.
- **Effect:** performance reports say so; nothing is estimated. Configure analytics or supply an export.

### Staging appears in Google
- **Symptom:** staging URLs show in search results.
- **Likely causes:** no noindex signal; robots.txt only; staging linked publicly.
- **Command:** `/BWESEOTechnical` (environment protection). Add a noindex header or sign-in; then remove the URLs through Search Console (owner action).
- **Do not:** submit a staging URL for anything, ever.

### BWESEO state disagrees with the live site
- **Symptom:** "RECORDS DON'T MATCH REALITY".
- **Diagnose:** trust evidence over labels; `/BWESEO <page>` shows lifecycle and live health separately.
- **Do not:** rewrite history to match a temporary observation.

### Engine version mismatch
- **Symptom:** `--verify` reports the project's engine differs from the canonical engine.
- **Fix:** `/BWESEOInstall --dry-run --update`, review, then `--update`. **Do not** edit engine files inside the project.

### /BWESEOInstall verification failure
- **Symptom:** missing files, hash mismatch, leakage, or no receipt.
- **Diagnose:** read the gate and corrective action the installer printed (it never prints secret values).
- **Do not:** edit the manifest, the scans or the registry to make it pass.

## Human Approval Gates

**Safe automation** (no approval needed): read-only state assessment; audits and analysis; read-only live checks; QA
runs; writing reports; recording an owner's own dated statement.

**Human approval required:**

| Gate | Who decides |
|---|---|
| Which opportunity/page to build | The owner (one page at a time) |
| Content/page approval before creation | The owner |
| Staging approval (looks right on staging) | The owner |
| Production deployment | The owner, explicitly ("go") — a staging approval is not permission |
| Changing prices, business facts or a live page substantially | The owner |
| Major navigation changes | The owner |
| Destructive migrations | The owner |
| External account changes (Search Console property, sitemap registration, DNS, hosting, analytics) | The owner |
| Creating, claiming or editing a Google Business Profile; posting a review reply or a profile post | The owner (the engine only drafts and records) |
| Committing or pushing | The owner |

An approval covers one action and never carries over to the next.

## State Model Reference

| State | Level | Meaning |
|---|---|---|
| Installation | Site | Engine installed; versions, adapter, receipt |
| Setup | Site | Profile, config and inventory exist and validate |
| Lifecycle | Page | Approved → created → QA → staging → production → post-publication → monitoring (historical truth) |
| Deployment | Page | Where the page is deployed (staging / production) |
| Live health | Site (and per page) | Current availability observation — independent of lifecycle |
| Google readiness | Page | The page can be discovered and indexed |
| Search Console | Site | Property, ownership, API status |
| Sitemap | Site (registration) / Page (membership) | Registered with Search Console / this URL is in it |
| Discovery | Page | Google knows the URL |
| Crawl | Page | Google fetched it |
| Indexing | Page | The URL is on Google (evidence only) |
| Monitoring | Page | Review checkpoints and performance |

## Directory Reference *(generated)*

| Path | What it is |
|---|---|
| `.claude/` | The engine repository's own maintenance skills (session start, checkpoint, wrap-up and both together) — repository-local, portable, never installed into a customer project. |
| `.gitattributes` | Keeps every engine text file on LF line endings, so file hashes are identical on every machine. |
| `.github/` | The repository's own GitHub Actions workflows, such as the "Show operating guide" button in the Actions tab (development only; never installed). |
| `.gitignore` | Keeps credentials, local state and customer data out of any repository. |
| `adapters/` | Website-stack notes (static HTML, Astro, Next.js, TanStack Start, PHP, WordPress, …) — where SEO things live in each kind of site. Provider-specific behavior belongs here, not in the core. |
| `BWESEO-SKILLS-AND-PROCEDURES.md` | This manual (generated by `scripts/build-manual.mjs`). |
| `CLAUDE.md` | Project instructions for working on the engine itself (development record; never installed). |
| `config/` | Engine configuration, such as the operator names the isolation scan allows. |
| `docs/` | Methodology, industry guides, the engine overview (`ENGINE.md`), the step-by-step operating guide for people working without Claude (`OPERATING-GUIDE.md`), the per-skill reference data, this manual's template, and the refactor records (development only). |
| `engine-manifest.json` | The installation manifest: an allowlist of every installable file with its class, install target and sha256. Rebuilt by `scripts/build-manifest.mjs`. |
| `installer/` | `bweseo-install.mjs` — the installer behind `/BWESEOInstall` (install, dry run, verify, update, skill sync) — and its schema migrations. |
| `node_modules/` | Development dependencies (not part of the package). |
| `package-lock.json` | Pins the exact versions of the test tooling so a local checkout and a cloud checkout install the same thing (development only; never installed into a project). |
| `package.json` | Development tooling for the engine's own tests (no runtime dependencies). |
| `PROJECT_STATUS.md` | Session briefing for working on the engine itself (development record; never installed). |
| `README.md` | The concise introduction; points to this manual. |
| `schemas/` | JSON Schemas for a project's business profile, content inventory and SEO configuration. Installed into `seo/schema/`. |
| `scripts/` | Engine maintenance: rebuild the manifest, generate/check this manual, validate the whole package, register the engine location, install into a website in one command (`bootstrap.mjs`), print the operating guide (`npm run guide`). |
| `skills/` | Canonical source of every BWESEO Claude skill (`skills/<name>/SKILL.md`). Claude Code needs installed copies elsewhere; `/BWESEOInstall --sync-skills` installs them from here — never the other way round. |
| `src/` | Reusable engine code: the state machine (`seo-state-core.mjs`, `seo-state.mjs`), the post-publication checker, the Google/Search Console layer, the validator, type declarations, and the generic tests that ship with them. Installed into a project's `seo/tools/`. |
| `templates/` | Blank, customer-neutral starter files (profile, config, inventory, docs shells). Never overwritten once a project has its own. |
| `tests/` | The engine's own regression tests: canonical-package validation and installer behavior (isolation, dry run, verify, update, migration, preservation). |
| `VERSION` | The engine's own semantic version — independent of any website's version. |
| `vitest.config.mjs` | Test runner configuration. |

Customer-specific data lives **only** in the customer's website project (`seo/`, `docs/seo/`): the business profile,
`seo-config.json`, the content inventory, lifecycle and health history, Search Console/analytics state, research,
roadmaps and reports. It is never part of the canonical engine.

## Engine Maintenance

```
Canonical engine  the SEOEngine checkout ($BWESEO_ENGINE_HOME)
        ↓
make engine change
        ↓
run tests                    (npx vitest run)
        ↓
security/leakage scan        (node scripts/validate-canonical.mjs)
        ↓
version update if appropriate (VERSION + ENGINE_VERSION/STATE_VERSION, kept identical)
        ↓
manifest validation          (node scripts/build-manifest.mjs, then validate-canonical)
        ↓
disposable installation test (part of the canonical tests)
        ↓
customer project
        ↓
/BWESEOInstall --dry-run --update
        ↓
/BWESEOInstall --update
        ↓
/BWESEOInstall --verify
```

- **Direction:** canonical engine → website project. Never the reverse, except through a separate, explicitly
  approved engine-development process. Customer projects must never silently write changes back.
- **Customer-specific data must never contaminate the canonical engine.** The manifest is an allowlist (default
  deny); the secret scan and the project-identity scan run on every build and every install.
- **Versions:** the engine's version is independent of any website's version. `engineVersion`, `schemaVersion` and
  `manifestVersion` are separate. Bump the schema version only when a customer data file's shape changes (and add a
  migration).
- **Regenerate the manifest** after *any* engine file change (it records a hash per file). Regenerate this manual
  with `node scripts/build-manual.mjs`.
- **Backups:** this is the working source, not a backup: keep it under version control and back it up independently of the
  machine it is checked out on (see README).

## What Do I Run?

| Situation | Run |
|---|---|
| I just opened an existing SEO project | `/BWESEO` |
| I have a brand-new customer website | `/BWESEOInstall --dry-run` |
| I installed BWESEO | `/BWESEOInstall --verify` |
| Installation is verified | `/BWESEOSetup` |
| I don't know what comes next | `/BWESEO` |
| I want to check one page | `/BWESEO <path-or-url>` |
| I want to update BWESEO | `/BWESEOInstall --dry-run --update` |
| I want to check Google status | `/BWESEO` (or `/BWESEOSearchConsole` to read Google's data) |
| I want to know if a page is live and indexable | `/BWESEOPublish <page>` |
| I want a monthly summary | `/BWESEOReport` |
| I want to set up or improve the Google Business Profile | `/BWESEOLocal gbp` (or `node seo/tools/seo-local-gbp.mjs status`) |
