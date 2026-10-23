---
name: BWE-OCA-DEPLOY-DISABLE
description: Turns OFF deploying for the One Click Answers project (Z:\Backup\websites\OneClickAnswers) by creating the .deploy-disabled flag file, so `npm run deploy:staging`, `npm run deploy` (production) and `npm run deploy:www` stop before building or uploading anything, and Claude does not deploy by any route. Use when the user says "disable deploy", "stop deploying", "turn off deploys", or invokes /BWE-OCA-DEPLOY-DISABLE, in the context of the One Click Answers project.
---

# BWE-OCA-DEPLOY-DISABLE

> **Where it runs (local or cloud):** `Z:\Backup\websites\OneClickAnswers` below is the owner's local Windows checkout and is optional. In any other checkout (a cloud Claude Code project, Linux or macOS) use the repository root, the folder that holds `CLAUDE.md`; nothing in this skill needs the `Z:` drive. See docs/CLAUDE-PROJECT-MIGRATION.md.
>
> **Cloud sessions:** creating the flag file works anywhere; commit it on the session's branch and hand it over through a pull request (never push to `main`).

Disable deploying in `Z:\Backup\websites\OneClickAnswers`. The switch is ONE file: `.deploy-disabled` in the project root. While it exists, `scripts/deploy.mjs` (staging and production) and `npm run deploy:www` import/run `scripts/deploy-guard.mjs`, print "DEPLOY BLOCKED" and exit 2 before they build, bump a version, apply publication or category requests, or touch Cloudflare. Claude must not deploy by any other route either (`npx wrangler deploy`, `wrangler triggers deploy`, `/BWE-OCA-CHECKPOINT`, `/BWE-OCA-ALL`), and "deploy to staging after every change" is suspended until the flag is removed.

## Do
1. Work in `Z:\Backup\websites\OneClickAnswers`. If `scripts/deploy-guard.mjs` does not exist, say so and stop (the project predates the switch).
2. Create `.deploy-disabled` with one line: `disabled <today's date YYYY-MM-DD> by the owner (/BWE-OCA-DEPLOY-DISABLE). Use /BWE-OCA-DEPLOY-ENABLE to deploy again.` (Write tool, UTF-8, no BOM.) If it already exists, leave it and say it was already disabled.
3. Run `node scripts/deploy.mjs staging` once and confirm it prints `DEPLOY BLOCKED` and exits 2 (it does nothing else while the flag exists).
4. Stage the flag file by name and commit it with the message `Disable deploying` plus the attribution trailer from the session instructions; push only if `git remote -v` shows a remote and the owner has been using /BWE-OCA-GIT this session (otherwise leave it committed locally and say so). Never commit other files with it.
5. Report: that deploying is now DISABLED, how it is enforced (the flag file and `scripts/deploy-guard.mjs`), what still runs (`npm test`, `npm run check`, local builds, `npm run dev`), and how to turn it back on (`/BWE-OCA-DEPLOY-ENABLE`).

## Do not
- Do not edit `scripts/deploy.mjs`, `wrangler.jsonc` or any release file, and do not build, bump versions or run tests other than the one block confirmation in step 3.
- While disabled, every report must say "NOT deployed (deploying is disabled)" and must not show a staging or production URL as freshly updated.
