---
name: BWEOCAAll
description: Full end-to-end wrap-up for the One Click Answers tool site (OneClickAnswers.com) — runs BWEOCACheckpoint (staging AND production release), then BWEOCAEnd. Takes an optional version number (e.g. /BWEOCAAll 1.0.0); when omitted, auto-computes the next version (bump minor, reset patch) and passes it to BWEOCACheckpoint explicitly. Use when the user says "do it all", "checkpoint and wrap up", or invokes /BWEOCAAll, in the context of the One Click Answers project (Z:\Backup\websites\OneClickAnswers).
---

# BWEOCAAll

> **Machine-only (added 2026-10-06 for the repository copy):** this skill runs only on the owner's Windows machine (`Z:\Backup\websites\OneClickAnswers`); a release needs the Cloudflare (Wrangler) login on the owner's machine. The local behaviour below is unchanged. **In a cloud Claude Code project, do not attempt it:** say that it is local-only and stop; the cloud hand-off is a pull request, released later from the owner's machine or by the owner pressing Run on the GitHub Action "Release production" (never started by Claude). See docs/WORKFLOW.md "Local and cloud sessions" and docs/CLAUDE-PROJECT-MIGRATION.md.

When this skill is invoked, treat it exactly as if the user sent this message:

> Run /BWEOCACheckpoint, then /BWEOCAEnd, in that order.

Carry out that instruction directly from `Z:\Backup\websites\OneClickAnswers`, without asking between steps, and report
once at the end. This is a pure sequencing wrapper: follow each skill's own SKILL.md exactly.

## Version argument
- **Given:** it must be a plain `X.Y.Z`; reject anything else. Pass it to `/BWEOCACheckpoint`.
- **Omitted:** read `version.json`, bump the minor, reset patch to 0, and pass that.

## Sequence
1. `/BWEOCACheckpoint <version>`. If it stops early (site not scaffolded, a build failure, failed staging checks, or a
   production rollback), stop here and report exactly what staging and production are each serving.
2. `/BWEOCAEnd`.

Final report: the version (and whether it was supplied or auto-computed), both URLs, the checkpoint commit and status
commit hashes, and whether they were pushed.
