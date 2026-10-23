---
name: BWE-OCA-E2E-DISABLE
description: Turns OFF end-to-end (Playwright browser) testing for the One Click Answers project (Z:\Backup\websites\OneClickAnswers) by creating the .e2e-disabled flag file, so `npm run test:e2e` is skipped and Claude does not run the browser suite. Use when the user says "disable e2e", "turn off browser tests", or invokes /BWE-OCA-E2E-DISABLE, in the context of the One Click Answers project.
---

# BWE-OCA-E2E-DISABLE

> **Where it runs (local or cloud):** `Z:\Backup\websites\OneClickAnswers` below is the owner's local Windows checkout and is optional. In any other checkout (a cloud Claude Code project, Linux or macOS) use the repository root, the folder that holds `CLAUDE.md`; nothing in this skill needs the `Z:` drive. See docs/CLAUDE-PROJECT-MIGRATION.md.
>
> **Cloud sessions:** commit the flag file on the session's branch and hand it over through a pull request (never push to `main`).

Disable browser (e2e) testing in `Z:\Backup\websites\OneClickAnswers`. The switch is ONE file: `.e2e-disabled` in the project root. While it exists, `npm run test:e2e` (which runs `scripts/e2e.mjs`) prints "E2E TESTS SKIPPED" and exits 0 without starting Playwright, and Claude must not run Playwright by any route (`npm run test:e2e`, `npm run test:e2e:raw` or `npx playwright test`).

## Do
1. Work in `Z:\Backup\websites\OneClickAnswers`. If `scripts/e2e.mjs` does not exist, say so and stop (the project predates the switch).
2. Create `.e2e-disabled` with one line: `disabled <today's date YYYY-MM-DD> by the owner (/BWE-OCA-E2E-DISABLE). Use /BWE-OCA-E2E-ENABLE to turn browser tests back on.` (Write tool, UTF-8, no BOM.) If the file already exists, leave it and say it was already disabled.
3. Run `npm run test:e2e` once and confirm the output says `E2E TESTS SKIPPED`.
4. Stage the flag file by name and commit it with the message `Disable e2e testing` plus the attribution trailer from the session instructions; push only if `git remote -v` shows a remote and the owner has been using /BWE-OCA-GIT this session (otherwise leave it committed locally and say so). Never commit other files with it.
5. Report: that e2e is now DISABLED, how it is enforced (the flag file and `scripts/e2e.mjs`), what still runs (`npm test` unit and built-site tests, `npm run check`, builds, `npm run deploy:staging`), and how to turn it back on (`/BWE-OCA-E2E-ENABLE`).

## Do not
- Do not delete, edit or skip individual e2e spec files, and do not change `playwright.config.ts`: the specs stay in the repository and may still be written or updated when a change needs them, they are just not run.
- Do not build, deploy, bump versions or run tests other than the one skip confirmation in step 3.
- While disabled, every report must say "browser (e2e) tests were NOT run (disabled)" when tests are mentioned.
