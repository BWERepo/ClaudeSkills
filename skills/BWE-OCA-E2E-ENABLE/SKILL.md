---
name: BWE-OCA-E2E-ENABLE
description: Turns ON end-to-end (Playwright browser) testing for the One Click Answers project (Z:\Backup\websites\OneClickAnswers) by deleting the .e2e-disabled flag file, so `npm run test:e2e` runs the browser suite again. Use when the user says "enable e2e", "turn on browser tests", or invokes /BWE-OCA-E2E-ENABLE, in the context of the One Click Answers project.
---

# BWE-OCA-E2E-ENABLE

> **Where it runs (local or cloud):** `Z:\Backup\websites\OneClickAnswers` below is the owner's local Windows checkout and is optional. In any other checkout (a cloud Claude Code project, Linux or macOS) use the repository root, the folder that holds `CLAUDE.md`; nothing in this skill needs the `Z:` drive. See docs/CLAUDE-PROJECT-MIGRATION.md.
>
> **Cloud sessions:** commit the removal on the session's branch and hand it over through a pull request (never push to `main`).

Enable browser (e2e) testing in `Z:\Backup\websites\OneClickAnswers`. The switch is ONE file: `.e2e-disabled` in the project root. Without it, `npm run test:e2e` (which runs `scripts/e2e.mjs`) starts the Playwright suite normally.

## Do
1. Work in `Z:\Backup\websites\OneClickAnswers`. If `scripts/e2e.mjs` does not exist, say so and stop.
2. Delete `.e2e-disabled` if it exists (`git rm` if it is tracked, otherwise remove the file). If it does not exist, say e2e was already enabled.
3. Confirm with `node -e "console.log(require('fs').existsSync('.e2e-disabled'))"` that it prints `false`. Do NOT start the full suite just to prove it: it takes about 8 minutes. Mention that the next `npm run test:e2e` will run it.
4. Commit the removal by name with the message `Enable e2e testing` plus the attribution trailer from the session instructions; push only if `git remote -v` shows a remote and the owner has been using /BWE-OCA-GIT this session (otherwise leave it committed locally and say so). Never commit other files with it.
5. Report: that e2e is now ENABLED, the commands (`npm run test:e2e`, optionally with spec paths and `--project=desktop|mobile`; `npm run test:e2e:raw` for plain Playwright), roughly how long the full suite takes, and that browser tests will be run again as part of normal verification (and listed in reports).

## Do not
- Do not change any spec file or `playwright.config.ts`, build, deploy or bump versions.
