---
name: BWE-OCA-DEPLOY-STAGING
description: Deploys the current work of the One Click Answers project (Z:\Backup\websites\OneClickAnswers) to STAGING only (staging.oneclickanswers.com). It OVERRIDES the deploy-disabled and e2e-disabled switches for this one run: first runs the full browser (Playwright) suite, then, only if that passes, runs the staging deployment with a patch version bump, and reports the live staging URL and the real results. The switch files are left in place. Never touches production. Use when the user says "deploy to staging", "push to staging", or invokes /BWE-OCA-DEPLOY-STAGING, in the context of the One Click Answers project.
---

# BWE-OCA-DEPLOY-STAGING

> **Machine-only (added 2026-10-06 for the repository copy):** this skill runs only on the owner's Windows machine (`Z:\Backup\websites\OneClickAnswers`); a staging deploy needs the Cloudflare (Wrangler) login on the owner's machine. The local behaviour below is unchanged. **In a cloud Claude Code project, do not attempt it:** say that it is local-only and stop; the cloud hand-off is a pull request, deployed later from the owner's machine. See docs/WORKFLOW.md "Local and cloud sessions" and docs/CLAUDE-PROJECT-MIGRATION.md.

Owner direction (2026-10-03): this skill is the deliberate way past the two switches. `.deploy-disabled` and `.e2e-disabled` stay in the project root and keep blocking every other command; THIS skill bypasses them for its own run only: first the browser tests, then the staging deployment.

## Do
1. Work in `Z:\Backup\websites\OneClickAnswers`. Note whether `.deploy-disabled` and `.e2e-disabled` exist (report it at the end). Do NOT delete or edit them.
2. If another agent or session may be editing files at the same time (check `ListAgents` and the conversation), warn the owner that the tests and the deploy will use whatever is in the working tree right now, and ask before continuing if an agent is still running.
3. **Step 1, the browser tests (override of `.e2e-disabled`).** Run the full Playwright suite with `npm run test:e2e:raw` (the project script that runs the suite regardless of the flag; it takes about 8 minutes: run it in the background and wait for it to finish, do not poll). Report the real numbers: passed, failed, skipped. Known flaky tests under full parallel load (for example the homepage "every internal link works" and "the whole category card is clickable") may be re-run once on their own; any other failure is a regression.
4. **If any browser test fails, STOP.** Do not deploy. Report the failing tests (name, file, the first lines of the error) and what you think is wrong. Staging is only deployed after a clean (or explained-and-rerun-clean) browser run.
5. **Step 2, the staging deployment (override of `.deploy-disabled`).** Run the project script with the one-run override variable set: `BWE_DEPLOY_OVERRIDE=1 npm run deploy:staging` (in PowerShell: `$env:BWE_DEPLOY_OVERRIDE='1'; npm run deploy:staging`). The script applies the staging category and About requests, runs `npm run check` and `npm test`, bumps the patch version in `version.json`, builds for staging, deploys `wrangler deploy --env staging` and runs `verify:staging`. It takes several minutes: run it in the background and wait for it to finish, do not poll. The variable applies to that single command only; never export it, never write it to a file.
6. If the first step of the deploy fails with "Failed to fetch" from the Cloudflare API (a known transient network failure at `apply-categories.ts`), re-run once. For any other failure, do not retry blindly: read the failing output, report it, and stop. Never skip tests or checks, never use `--no-verify`, and never edit `scripts/deploy.mjs` or `scripts/deploy-guard.mjs` to get past a failure.
7. On success, report: the new version (from the script's last line or `version.json`), and ALWAYS show the live URL: https://staging.oneclickanswers.com (and the specific page URL if the work was about one page, for example https://staging.oneclickanswers.com/about). Report the real results of both steps: browser tests (passed / failed / skipped), unit test count, `npm run check`, and the `verify:staging` outcome ("All checks passed" or the failures).
8. Finish with the switch lines: "Deploy: DISABLED (overridden for this run; file left in place)" or "Deploy: ENABLED", and the same for E2E, based on whether `.deploy-disabled` and `.e2e-disabled` exist. Remind the owner that every other deploy or e2e command is still blocked while the files exist.

## Do not
- Do not deploy to production, run `npm run deploy` (production), `--confirm`, `wrangler triggers deploy`, or `/BWE-OCA-CHECKPOINT`.
- Do not delete the switch files, do not run /BWE-OCA-DEPLOY-ENABLE or /BWE-OCA-E2E-ENABLE on the owner's behalf, and do not use the override for anything other than this skill's two steps.
- Do not commit or push (use /BWE-OCA-GIT for that), and do not edit source files as part of the deploy.
- Do not claim the deploy worked unless the script finished with "Staging is live" and the verify step passed.
