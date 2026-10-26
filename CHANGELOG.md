# Changelog
## [2026.10.26.02] - 2026-10-26
- Bundled SEO engine 2026.10.26.02 (was 2026.10.20.03), which provides the tool BWE-SEO-WATCH needs. The bundle also brings everything the engine gained since 2026.10.20.03: the improvement queue (`seo-queue`), change-to-outcome history (`seo-outcomes`), the diagnostics command (`seo-doctor`), SEO regression detection (`seo-regression`), city landing pages (`seo-landing-city`), the shared safe-write helper and the search watch workflow (`seo-watch`, on by default after an install). Maintainer-only files are left out as before, the bundled operating guide names the maintenance steps as routines, and the bundle's manual and manifest were rebuilt (validation: READY). Websites receive the new tools on `/BWE-SEO-ENGINE install --update`. The existing BWE-SEO-* skills were not changed to mention the other new tools.
## [2026.10.26.01] - 2026-10-26
- Added BWE-SEO-WATCH: runs and verifies the Google search monitoring workflow (`seo-watch.mjs`: sitemap kept current from page events, a daily check of new pages plus a rotating sample, flags for pages Google has not indexed, crawl failures and unexpected canonicals, a weekly report with the three most useful fixes). Its `setup` mode walks the owner through the customer-site validation steps one at a time. Needs SEO engine 2026.10.26.02 or newer; the engine bundled in this plugin is still 2026.10.20.03, so the skill stops with an update message until a newer engine is bundled (a separate release step).
## [2026.10.25.03] - 2026-10-25
- Added scroll-craft, the upstream skill from github.com/nateherkai/scroll-craft (MIT, LICENSE.txt included), unmodified and keeping its upstream name. Builds scroll-driven landing pages with a layered hero and verified desktop, mobile and reduced-motion states. Reviewed: scripts only run locally (static server, Playwright screenshots, ffmpeg); the only network calls are to api.kie.ai when the owner supplies KIE_AI_API_KEY to generate imagery, and it is optional.
## [2026.10.25.02] - 2026-10-25
- Added ui-ux-pro-max, the upstream skill from github.com/nextlevelbuilder/ui-ux-pro-max-skill (MIT, LICENSE.txt included), keeping its upstream name. Searchable local design data (styles, palettes, font pairings, UX guidelines, charts, 22 stacks) and a design-system generator, run through its Python scripts (no network, no dependencies). Only change from upstream: script paths in SKILL.md point at the plugin layout (`${CLAUDE_PLUGIN_ROOT}/skills/ui-ux-pro-max`), and the upstream test suite was left out. Reviewed: scripts only read bundled data and write files only when `--persist` is used.
## [2026.10.25.01] - 2026-10-25
- Added frontend-design, the upstream skill from github.com/anthropics/skills (Apache 2.0, LICENSE.txt included), unmodified and keeping its upstream name like `impeccable`. Guidance for distinctive visual design when building or reshaping UI: a design plan reviewed against the brief, deliberate typography, avoiding templated defaults, and copy as design material. Available to every project that installs bwe-skills.
## [2026.10.24.01] - 2026-10-24
- Added BWE-BACKUP: a general, project-neutral backup of the current project folder (with git history) to a timestamped zip at an owner-named destination, leaving out rebuildable folders and secrets. Local-only; BWE-OCA-BACKUP stays the skill for One Click Answers.
## [2026.10.23.03] - 2026-10-23
- Added BWE-ALL-ENGINES-CHECK: takes a website project name and, read-only, compares the installed SEO, FAQ and Blog engine versions with the latest in each BWERepo engine repo, then prints a table and an update needed / up to date verdict per engine.
## [2026.10.23.02] - 2026-10-23
- Consolidated 85 skills to 60 and renamed every BWE skill to the upper-case `BWE-<AREA>-<ACTION>` scheme (for example BWESEOAudit is now BWE-SEO-AUDIT). The upstream `impeccable` skill keeps its name.
- BWE-BLOG-ENGINE, BWE-FAQ-ENGINE and BWE-SEO-ENGINE are now the single control panel per engine (version, installed, install, update; SEO also verify and dry-run). Their detailed procedures moved to each panel's `reference/` folder. Removed as separate skills: BWE{Blog,FAQ,SEO}Install, BWE{Blog,FAQ,SEO}Version, BWE{Blog,FAQ,SEO}InstalledVersion, BWEBlogUpdate, BWESEOUpdate, BWESEOInstallDryRun, BWESEOInstallUpdate, BWESEOInstallVerify.
- BWEListGlobalSkills and BWEListProjectSkills merged into BWE-SKILLS; BWEImpeccableCommands merged into BWE-IMPECCABLE.
- Removed BWEFAQBegin, BWEFAQCheckpoint, BWEFAQEnd, BWEFAQAll, BWESEOBegin, BWESEOCheckpoint, BWESEOEnd, BWESEOAll from the plugin (the engine repositories carry them in their own `.claude/skills`).
- BWEFAQUpdate renamed BWE-FAQ-REFRESH so UPDATE only means updating an engine. BWE_UpdateSkills renamed BWE-SKILLS-UPDATE. The One Click Answers skills are now BWE-OCA-*.
## [2026.10.23.01] - 2026-10-23
- Added BWEInstallAllEngines: installs or updates the latest SEO, FAQ and Blog engines into one website in a single run (reusing the single-engine install logic), then displays the installed version of each engine. Never deploys.
## [2026.10.22.03] - 2026-10-22
- Added BWE_UpdateSkills: runs `claude plugin marketplace update bwe-skills` and `claude plugin update bwe-skills@bwe-skills` at the scope the plugin is installed with in the current project, reports the version before and after, and says when to restart the session. Asks before installing or enabling the plugin where it is missing or disabled.
- BWE_MobbinResearch troubleshooting now points to BWE_UpdateSkills.

## [2026.10.22.02] - 2026-10-22
- Added BWE_MobbinResearch: design research with the Mobbin MCP connector. Reads the project, searches Mobbin screens, flows and sections (including adjacent industries), scores candidates on a configurable weighted rubric, narrows them to a ranked 5-8 reference shortlist, proposes three distinct design directions, stops for the owner's approval, then writes `docs/design/BWE-DESIGN-SPEC.md`. Modes research, audit, refresh, compare, handoff. Falls back to chat-research or manual references when Mobbin is not available in the session; never fabricates results and never edits application code. Includes `scripts/score.mjs` (weighted scores, duplicates, shortlist diversity, spec check) with tests, the BWE website workflow guide and a worked event-rental example. Separate from Impeccable: Mobbin research decides what to build; Impeccable refines what was built.

## [2026.10.22.01] - 2026-10-22
- Added BWE_FAQEngine, BWE_SEOEngine, BWE_BlogEngine: one control-panel skill per engine with the same three actions (latest version, version installed in each client site, install latest). Added BWE_Skills to list skills and to create or edit skills through a PR, with no terminal. New skills use the BWE_ prefix.

## [2026.10.21.01] - 2026-10-21
- Renamed BWESkills to BWEListProjectSkills (it lists the BWE skills installed in the current project). Invoke as `/bwe-skills:BWEListProjectSkills`; the old name no longer exists in the plugin.
- Added BWESEOVersion, BWEFAQVersion, BWEBlogVersion (engine version bundled in the plugin) and BWESEOInstalledVersion, BWEFAQInstalledVersion, BWEBlogInstalledVersion (engine version installed in the current website). All read-only.
- Added BWEListGlobalSkills: a read-only skill that prints a formatted list of every skill in the catalog (grouped, one line each, with the total and version) from `SKILL-CATALOG.md`.

## [2026.10.20.08] - 2026-10-20
- BWESEOInstall, BWEFAQInstall and BWEBlogInstall now fetch the latest engine from GitHub on every run (BWERepo/SEOEngine, BWERepo/FAQEngine, BWERepo/BlogEngine) instead of using the engine bundled in this plugin. Their other steps are unchanged. The Update skills and the other skills still use the bundled engines.

## [2026.10.20.07] - 2026-10-20
- BWESEOInstall now always runs the installer from the plugin's bundled engine (`--engine`), instead of the installer's own lookup, which could pick an older engine checkout recorded in `engine-location.json` and install that.

## [2026.10.20.06] - 2026-10-20
- Refreshed the bundled SEO engine to 2026.10.20.03. Fixes updating a website from this bundled copy: the installer's manifest check no longer fails on the engine's own development files (CLAUDE.md, maintenance skills), which are intentionally not bundled.

## [2026.10.20.05] - 2026-10-20
- BWESEOInstall now refreshes the bwe-skills plugin first (and asks for a restart if the plugin changed), then installs or updates the website engine. It replaces BWESEOSync, which is removed (released earlier today as 2026.10.20.04).

## [2026.10.20.04] - 2026-10-20
- Added skill BWESEOSync: refreshes the plugin, asks for a restart if it changed, then runs BWESEOInstallUpdate and BWESEOInstallVerify in the website.

## [2026.10.20.03] - 2026-10-20
- Refreshed the bundled SEO engine to 2026.10.20.02 (version bump and documentation; no change to what websites receive).

## [2026.10.20.02] - 2026-10-20
- Refreshed the bundled SEO engine to 2026.10.20.01 (from the SEOEngine repository). Adds the SEO Landing Page Generator: `seo-landing.mjs`, keyword intake, new-vs-improve planning, quality gate, approval workflow and a dashboard template.
- Added skill BWESEOLanding. Websites keep their own installed engine copy; run BWESEOInstallUpdate in a website to take the new engine.
## [2026.10.20.01] - 2026-10-20
- Version format is now yyyy.mm.dd.nn (date plus a two-digit sequence for that day). Earlier releases keep their 0.x numbers.
- Refreshed the bundled SEO engine (now 2026.10.19.01, adds `seo-site-checks`) and Blog engine (2026.10.19.01) from their source repositories; the FAQ engine was already current.
- BWESEOLocal (adds Google Business Profile mode) and BWESEOTechnical (adds production site checks) now follow the SEOEngine versions, with the bundled-engine path wording.
- Compared the skills of BWE, HDBS, OneClickAnswers, SEOEngine, FAQEngine and BlogEngine with the catalog: BWE and HDBS carry the same set as OneClickAnswers. The only skills not already in the catalog were project-specific; see the next item.
- Added 25 project-specific skills copied unchanged, at the owner's request: BWEDeployDisable, BWEDeployEnable, BWEDeployStaging, BWEE2EDisable, BWEE2EEnable, BWEOCAAll, BWEOCABackup, BWEOCABegin, BWEOCACheckpoint, BWEOCAEnd, BWEOCAGit, OCAAnswer, OCAArticle, OCAArticles, BWEWorkQueue, BWEWorkQueueNotStarted, BWEWorkQueueToday (One Click Answers only) and BWESEOAll/Begin/Checkpoint/End, BWEFAQAll/Begin/Checkpoint/End (engine source repositories only). They work only in those projects and are marked so in the catalog. This is an exception to the self-contained rule.

## [0.5.0] - 2026-10-10
- Skills are now self-contained. The SEO, FAQ and Blog engines are bundled under `engines/seo`, `engines/faq` and `engines/blog` (copied from the engine repositories at SEO 1.10.0, FAQ and Blog 1.0.0, without git history, tests of the host repos or their CLAUDE.md files). Skills locate them relative to the skill's base directory (`../../engines/<name>`); `BWESEO_ENGINE_HOME`, `BWEFAQ_ENGINE_HOME`, `BLOG_ENGINE_HOME` and `engine-location.json` are no longer used.
- BWEBlog now runs the engine from the website's own `.bwe-engine/` copy. Added BWEBlogInstall, BWEBlogUpdate, BWEBlogSetup, BWEBlogGenerate, BWEBlogReview, BWEBlogPublish (written for this catalog from the engine's real commands; none existed before).
- Added BWEFAQSetup, BWEFAQGenerate, BWEFAQReview, BWEFAQPublish (copied unchanged from FAQEngine `skills/`).
- BWESEOInstall and BWESEOUpdate no longer use `--sync-skills` or `git pull`: the plugin provides the skills and a newer engine arrives with a plugin update.
- Note: the engine repositories' own rules say not to copy the engine elsewhere; bundling was the owner's explicit choice.

## [0.4.2] - 2026-10-10
- Removed OneClickAnswers-specific wording from BWEBlog, BWEExport, BWEImport, BWEProductionReady and BWESkills (dropped the OCA adapter section; handoff files are now `session-handoff-*.txt`). Engine-checkout dependencies are addressed in a later release.

## [0.4.1] - 2026-10-10
- Renamed skill `bweimpeccable` to `BWEImpeccable` (folder, name, references). Invoke as `/BWEImpeccable`. BWEWow still finds a project-local lowercase copy.

## [0.4.0] - 2026-10-10
- Added 26 skills from BWERepo/OneClickAnswers `.claude/skills`: BWEBlog, BWEExport, BWEImport, BWESkills, BWEWow, BWEImpeccableCommands, bweimpeccable, impeccable (third-party, Apache 2.0, with its LICENSE and NOTICE.md) and 18 BWESEO* skills. Added agents/ (the four Impeccable agents).

## [0.3.0] - 2026-10-10
- Added BWEFAQ, BWEFAQInstall, BWEFAQUpdate (copied unchanged from BWERepo/FAQEngine `skills/`). BWEFAQRefresh was requested but does not exist in that repo.

## [0.2.0] - 2026-10-10
- Added BWESEO, BWESEOInstall, BWESEOUpdate (copied unchanged from BWERepo/SEOEngine `skills/`).

## [0.1.0] - 2026-10-10
- Initial release: BWEClaudeHung, BWEClaudeStatus, BWEProductionReady.
