# Changelog
## [0.5.1] - 2026-10-20
- Refreshed the bundled SEO engine (now 2026.10.19.01, adds `seo-site-checks`) and Blog engine (2026.10.19.01) from their source repositories; the FAQ engine was already current.
- BWESEOLocal (adds Google Business Profile mode) and BWESEOTechnical (adds production site checks) now follow the SEOEngine versions, with the bundled-engine path wording.
- Compared the skills of BWE, HDBS, OneClickAnswers, SEOEngine, FAQEngine and BlogEngine with the catalog: BWE and HDBS carry the same set as OneClickAnswers. The 23 skills not in the catalog are project-specific (OneClickAnswers deploy/release/queue, repo maintenance) and were not imported.

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
