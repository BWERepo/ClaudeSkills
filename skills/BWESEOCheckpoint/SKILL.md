---
name: BWESEOCheckpoint
description: Checkpoint for the BWESEO engine source repository — regenerates the manual and manifest, runs canonical validation with the test suite, then commits and pushes to the repository's remote. No deploy, no version bump unless asked. Use when the user says "checkpoint", "checkpoint everything", or invokes /BWESEOCheckpoint, in the context of the SEOEngine repository.
---

# BWESEOCheckpoint

**Repository root:** the directory that contains `VERSION`, `engine-manifest.json` and `scripts/validate-canonical.mjs` — normally the
current working directory, otherwise `$BWESEO_ENGINE_HOME`. Never assume a drive letter or a fixed path.

When invoked, treat it as the user's explicit go-ahead to run these steps from the repository root without asking before each one.
Report the result of each. This project is the engine source, not a website: there is no staging or production deploy.

0. Dependencies: if `node_modules/` is missing, run `npm ci` (it uses the committed `package-lock.json`).
1. Operating guide: review this session's changes against `docs/OPERATING-GUIDE.md` and update it for anything a person runs or
   follows (commands, subcommands, flags, scripts, skills, workflow, release steps). Step 2 fails if it has drifted.
   Then `node scripts/build-manual.mjs`, then `node scripts/build-manifest.mjs`
   (the manifest must be rebuilt after ANY engine file change).
2. `node scripts/validate-canonical.mjs --run-tests` (covers tests, secret/customer-identity leakage,
   manifest hashes). Any failure → **stop**, report it, do not commit.
3. Version: do NOT bump `VERSION`/`package.json` unless the user names one (e.g. `/BWESEOCheckpoint 2026.10.19.01`);
   if given, update both, rebuild the manifest, and re-run step 2.
4. `git status` / `git diff --stat`. Stage by name (never blindly `git add -A`); never stage `.env*`, keys, `seo/data/` or anything the
   leakage scan flagged. Nothing to commit → say so, skip to step 6.
5. Commit with a concise "why" message matching `git log` style, ending with the attribution line from the
   session's system reminder. Then `git push` to the current branch's remote. If the user asked for a local-only checkpoint, or no
   remote is configured, commit only and say so.
6. Confirm the user-level copy of the canonical skills is in sync:
   `node installer/bweseo-install.mjs --sync-skills --dry-run` (from the repository root; it locates the engine through
   `BWESEO_ENGINE_HOME`, or pass `--engine .`). Report any drift (the repository is canonical) and ask before applying it.

Finish with: commit hash, test result, and the remote URL (`git remote get-url origin`).
