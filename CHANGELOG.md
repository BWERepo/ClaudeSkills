# Changelog
## [2026.10.21.01] - 2026-10-21
- Added BWEList: a read-only skill that lists every skill in the catalog (grouped, one line each, with the total) from `SKILL-CATALOG.md`.

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
