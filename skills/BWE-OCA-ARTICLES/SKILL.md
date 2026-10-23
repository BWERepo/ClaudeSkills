---
name: BWE-OCA-ARTICLES
description: Review the One Click Answers blog Article Opportunity Registry (Z:\Backup\websites\OneClickAnswers) and recommend which question article to write next. Read-only; writes nothing and publishes nothing. Use when the user invokes /BWE-OCA-ARTICLES or asks what blog articles to write next.
---

# BWE-OCA-ARTICLES

> **Where it runs (local or cloud):** `Z:\Backup\websites\OneClickAnswers` below is the owner's local Windows checkout and is optional. In any other checkout (a cloud Claude Code project, Linux or macOS) use the repository root, the folder that holds `CLAUDE.md`; nothing in this skill needs the `Z:` drive. See docs/CLAUDE-PROJECT-MIGRATION.md.

Usage: `/BWE-OCA-ARTICLES`. Project: `Z:\Backup\websites\OneClickAnswers`. Read-only: do not edit files, build or deploy. Read `docs/BLOG_ARTICLES.md` for the rules.

Do:
1. Print the registry state with a small script (in the project's `.tmp` folder, run with `npx tsx`) that imports `src/registry/articles.ts` and `src/blog/posts.ts`: counts by `status` and `researchStatus`, the drafts and their post `status` (`statusOf`), the three tiers from `ranked()` (TOP 20 are the drafted first batch; NEXT 30 and FUTURE 50 follow by score), `modelRanked()` for the pure score order, the BLOCKED ideas from `blocked()` with their `holdReason`, and the merged and rejected ideas with their reasons. Remember that the owner can move statuses in the staging back office (Articles section); the saved choices are in `src/blog/articles-applied.json` after a release.
2. Recommend the NEXT one to three articles to write. Prefer: a high priority score; a different topic and series from the recent drafts (keep the mix balanced); sources that exist and can be read; no HIGH-risk formula (`needs-verified-formula` waits); no duplicate of an existing post, tool page or What Is answer. Explain each pick in a sentence. Say which ideas are blocked and what would unblock them (a source, an engine, the owner's decision).
3. Flag housekeeping: a draft whose post is missing, a registry idea with a rejected or merged reason that needs the owner, any `researchNote` that says a source could not be read (a human must check it before publishing), and any draft older than its sources' dates.
4. Say plainly that nothing is published: every draft is on staging only until the owner approves it and a release runs. Never state a search volume, keyword difficulty, CPC or traffic number: they are unknown.
5. Report in a short table: rank, title, topic, series, score, status, blocker.
