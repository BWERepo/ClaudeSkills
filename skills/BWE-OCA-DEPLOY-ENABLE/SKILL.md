---
name: BWE-OCA-DEPLOY-ENABLE
description: Turns ON deploying for the One Click Answers project (Z:\Backup\websites\OneClickAnswers) by deleting the .deploy-disabled flag file, so `npm run deploy:staging`, `npm run deploy` (production) and `npm run deploy:www` work again. Use when the user says "enable deploy", "start deploying", "turn on deploys", or invokes /BWE-OCA-DEPLOY-ENABLE, in the context of the One Click Answers project.
---

# BWE-OCA-DEPLOY-ENABLE

> **Where it runs (local or cloud):** `Z:\Backup\websites\OneClickAnswers` below is the owner's local Windows checkout and is optional. In any other checkout (a cloud Claude Code project, Linux or macOS) use the repository root, the folder that holds `CLAUDE.md`; nothing in this skill needs the `Z:` drive. See docs/CLAUDE-PROJECT-MIGRATION.md.
>
> **Cloud sessions:** deleting the flag file works anywhere, but a cloud session still never deploys (no Cloudflare login, see CLAUDE.md); commit on the session's branch and hand it over through a pull request.

Enable deploying in `Z:\Backup\websites\OneClickAnswers`. The switch is ONE file: `.deploy-disabled` in the project root. Without it, `scripts/deploy-guard.mjs` lets `npm run deploy:staging`, `npm run deploy -- --confirm` and `npm run deploy:www` run normally.

## Do
1. Work in `Z:\Backup\websites\OneClickAnswers`. If `scripts/deploy-guard.mjs` does not exist, say so and stop.
2. Delete `.deploy-disabled` if it exists (`git rm` if it is tracked, otherwise remove the file). If it does not exist, say deploying was already enabled.
3. Confirm with `node -e "console.log(require('fs').existsSync('.deploy-disabled'))"` that it prints `false`. Do NOT deploy just to prove it.
4. Commit the removal by name with the message `Enable deploying` plus the attribution trailer from the session instructions; push only if `git remote -v` shows a remote and the owner has been using /BWE-OCA-GIT this session (otherwise leave it committed locally and say so). Never commit other files with it.
5. Report: that deploying is now ENABLED, the commands (`npm run deploy:staging` after every change with a patch bump; production only through `/BWE-OCA-CHECKPOINT` or `/BWE-OCA-ALL`), and that changes made while deploying was disabled are NOT on staging yet: the next `npm run deploy:staging` will publish them.

## Do not
- Do not deploy, build, bump versions or edit any release file as part of enabling.
