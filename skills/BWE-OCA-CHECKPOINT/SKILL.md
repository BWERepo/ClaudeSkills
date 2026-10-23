---
name: BWE-OCA-CHECKPOINT
description: Full release for the One Click Answers tool site (OneClickAnswers.com) at an explicit version (or auto-bumped minor if none given) — builds and deploys staging, verifies it (including noindex), rebuilds and deploys the same version to production, verifies it (including that it is indexable), then commits and pushes. Use when the user says "checkpoint", "checkpoint everything", or invokes /BWE-OCA-CHECKPOINT (with or without a version, e.g. /BWE-OCA-CHECKPOINT 1.0.0), in the context of the One Click Answers project (Z:\Backup\websites\OneClickAnswers).
---

# BWE-OCA-CHECKPOINT

> **Machine-only (added 2026-10-06 for the repository copy):** this skill runs only on the owner's Windows machine (`Z:\Backup\websites\OneClickAnswers`); a release needs the Cloudflare (Wrangler) login on the owner's machine. The local behaviour below is unchanged. **In a cloud Claude Code project, do not attempt it:** say that it is local-only and stop; the cloud hand-off is a pull request, released later from the owner's machine or by the owner pressing Run on the GitHub Action "Release production" (never started by Claude). See docs/WORKFLOW.md "Local and cloud sessions" and docs/CLAUDE-PROJECT-MIGRATION.md.

When this skill is invoked, treat it exactly as if the user sent this message:

> Checkpoint staging and production to version X.Y.Z (or the next minor version, if none was given).

Carry out that instruction directly, from `Z:\Backup\websites\OneClickAnswers`, without asking before each step. The
invocation is the go-ahead. Report back at the end.

This skill only runs when explicitly invoked. Ordinary changes go to staging only (`npm run deploy:staging` with a
patch bump) and never reach production outside this skill.

## Steps

0. **Preflight.** If `package.json` is missing or lacks the `build`, `deploy:staging` and `deploy` scripts, stop and
   say so: the site hasn't been scaffolded yet.
1. **Target version.** If one was supplied, it must be a plain `X.Y.Z`; reject anything else. Otherwise read
   `version.json`, bump the minor and reset patch to 0.
2. **Set `version.json`** to `{ "version": "X.Y.Z" }`. Write it as UTF-8 **without a BOM**: don't use
   `Set-Content -Encoding utf8` on PowerShell 5.1, and prefer the Write tool or bash `printf`.
3. **Deploy staging:** `npm run deploy:staging`. If the build errors or warns, stop and report. Confirm the wrangler
   output lists `staging.oneclickanswers.com (custom domain)`. Then verify against staging:
   - `/`, every tool page and the 404 page each return the expected status (200 for pages, 404 for a made-up path).
     Take the tool routes from the pages in `dist/`.
   - The HTML references the same `/_astro/` asset hashes as the local `dist/`.
   - Every response has `x-robots-tag: noindex`, and `/robots.txt` is `Disallow: /`.
   If any check fails, **stop**. Production must not ship.
4. **Capture production's current Version ID** (`npx wrangler@4.121.0 deployments list`) for rollback. The first
   production deploy has none, so say so.
5. **Deploy production:** `npm run deploy`, which rebuilds without the staging-only noindex files. Confirm the output
   lists `oneclickanswers.com (custom domain)`. Then run the same page checks against production, plus the inverse
   indexing checks:
   - There is **no** `x-robots-tag: noindex` header and no `<meta name="robots" content="noindex">`.
   - `/robots.txt` allows crawling and lists the sitemap, and the sitemap returns 200.
   - Canonical URLs point to `https://oneclickanswers.com/...`, not to staging.
   If they still fail after one retry, roll back with
   `npx wrangler@4.121.0 rollback <id> -y --message "auto-rollback: checkpoint check failed"`, skip the commit, and
   report. On a first deploy with nothing to roll back to, report the failure and leave production as it is.
6. **Commit and push:** check `git status` and stage by name (`dist/`, `.astro/` and `.wrangler/` are gitignored).
   Commit with a message like `Release vX.Y.Z` plus the attribution trailer. Push only if `git remote -v` shows a
   remote; if there is none, say so plainly.
7. **Report:** both URLs, the version (and whether it was supplied or auto-computed), both Version IDs, the commit hash,
   and whether it was pushed.
