# Migration review (2026-10-10)
Source reviewed: backup of the user's `~/.claude/skills` (111 skills) and `~/.agents/skills/impeccable`.

Migrated verbatim (generic): BWEClaudeHung, BWEClaudeStatus, BWEProductionReady.

Added in 0.2.0 from BWERepo/SEOEngine: BWESEO, BWESEOInstall, BWESEOUpdate (the other BWESEO* skills remain in that repo).

Excluded:
- `bweimpeccable`: not found in the backup; only upstream `impeccable` (third-party, installed from its own source; the project instructions already say to install it if missing).
- Cloudflare / wrangler / agents-sdk / durable-objects / sandbox-* / web-perf / workers-best-practices / turnstile-spin / Supabase: third-party or vendor content, not redistributed without permission.
- BWESEO* (engine + 25 skills): has its own versioned installer (BWESEOInstall) and a large engine directory; migrate deliberately in a later release.
- Project-specific: BWEOCA*, BWEDeploy*/E2E*/Reset/WorkQueue/ClaudeQuestions/ClaudeSettings (hard-coded to the OneClickAnswers path), BWEHDBS*, BWEJJS*, BWEJKCB*, BWEHVAC*, BWEFLF*, BWEDeepSprings*, BWESHS*, ETCC*, OCAArticle(s), BWEBegin/End/Checkpoint/All (BWE site), BWELogin, BWENewWebsite, BWEBackup (contains infrastructure details), BWEBackupSkills (Windows-only).

Added in 0.4.0 from BWERepo/OneClickAnswers `.claude/skills`: BWEBlog, BWEExport, BWEImport, BWESkills, BWEWow, BWEImpeccableCommands, bweimpeccable, impeccable and 18 BWESEO* skills, plus the four Impeccable agents in `agents/`.
`skills/impeccable` is third-party (Apache 2.0) and ships with its own LICENSE and NOTICE.md, which must stay with it.
Not copied (OneClickAnswers-specific): the BWEOCA*, BWEDeploy*, BWEE2E*, BWEWorkQueue*, OCA* skills and the BWEFAQ* skills not picked.
