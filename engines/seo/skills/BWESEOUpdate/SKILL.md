---
name: BWESEOUpdate
description: Updates the BWESEO engine and its Claude skills in the CURRENT website to the latest canonical engine version, in one guided pass. Pulls the engine checkout up to date (only if it is a clean Git checkout), previews the update, applies it with the customer's data preserved, syncs the skills, verifies, and reports the old and new versions. Never touches the customer's SEO data, never commits, never deploys. Use when the user says "update BWESEO", "update the SEO engine in this site", "upgrade the SEO version", "get the latest BWESEO", or invokes /BWESEOUpdate, in any website project.
---

# BWESEOUpdate

> `$BWESEO_ENGINE` = the canonical BWESEO engine directory: `$BWESEO_ENGINE_HOME` if set, else the `path` in
> `~/.claude/bweseo/engine-location.json`. If neither exists, stop and say so; do not guess a location.

One command for "bring this website up to the current engine". It chains the steps of `/BWESEOInstall`
(`--dry-run --update`, `--update`, `--sync-skills`, `--verify`) and never does anything those modes would not.
Direction of travel is one way: `CANONICAL ENGINE → THIS WEBSITE`. Nothing here edits the engine's files.

## Steps

1. **Confirm the target.** State the repo root and `git remote get-url origin`. It must be the customer's website
   project (it has `seo/bweseo-install.json`), not the engine directory. If there is no receipt, stop and recommend
   `/BWESEOInstall --dry-run` instead. If the working tree has uncommitted changes, say so and recommend committing
   or backing up first; do not commit for them.
2. **Get the newest engine.** Read `$BWESEO_ENGINE/VERSION`. If `$BWESEO_ENGINE` is a Git checkout with a clean
   tree, run `git -C "$BWESEO_ENGINE" pull --ff-only` and report the version before and after. If it is not a
   checkout, is dirty, or the pull cannot fast-forward, do not force anything: say so and continue with the engine
   as it is, or stop if the owner wants the newer version.
3. **Preview.** Run `node "$BWESEO_ENGINE/installer/bweseo-install.mjs" --dry-run --update` and show the plan
   **verbatim** (installed vs available version, files to update, files preserved, conflicts, migrations). If it says
   nothing needs updating, run step 6 only and report "already current".
4. **Ask for approval** before applying. Conflicts (files the customer changed since installing) are
   **REVIEW REQUIRED** and are left untouched; explain each difference and let the owner decide. Never overwrite.
5. **Apply.** Run `node "$BWESEO_ENGINE/installer/bweseo-install.mjs" --update`. Schema migrations back up, validate
   and roll back on failure. If any gate refuses (manifest invalid, secrets or project data found, identity
   mismatch, incompatible version), report the gate and corrective action exactly as printed and stop. Never work
   around a gate: do not edit the manifest, engine, scan patterns or registry.
6. **Skills.** Run `--sync-skills --dry-run`, show it, and (with approval) `--sync-skills`. Use
   `BWESEO_SKILLS_DIR="$PWD/.claude/skills"` if the site keeps its skills in the repository. A hand-edited skill is a
   conflict and is never overwritten.
7. **Verify.** Run `--verify` and show the result.
8. **Report** in a few lines: engine version before → after, what changed, what was left for review, and the next
   action `--verify` recommends (normally `/BWESEO`). Remind them the changes are uncommitted for them to review and
   commit.

## Never

Commit, push or deploy; edit the customer's `seo/` data, profile, configuration or inventory; overwrite a
customer-modified file; edit the canonical engine's files (a fast-forward `git pull` of the checkout is the only
change to it); change DNS, hosting, Search Console or analytics; print a secret.
