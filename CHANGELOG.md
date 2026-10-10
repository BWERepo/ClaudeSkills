# Changelog
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
