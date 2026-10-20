---
name: BWEOCAEnd
description: End-of-session wrap-up for the One Click Answers tool site (OneClickAnswers.com) — updates PROJECT_STATUS.md with everything accomplished in the current session, then commits (and pushes if a remote exists), written so a brand-new Claude Code session can resume with no prior context. Use when the user says "wrap up", "end of session", "update project status", or invokes /BWEOCAEnd, in the context of the One Click Answers project (Z:\Backup\websites\OneClickAnswers).
---

# BWEOCAEnd

> **Where it runs (local or cloud):** `Z:\Backup\websites\OneClickAnswers` below is the owner's local Windows checkout and is optional. In any other checkout (a cloud Claude Code project, Linux or macOS) use the repository root, the folder that holds `CLAUDE.md`; nothing in this skill needs the `Z:` drive. See docs/CLAUDE-PROJECT-MIGRATION.md.
>
> **Cloud sessions:** commit on the session's own branch and hand the change over through a pull request; never push to `main` from a cloud session.

When this skill is invoked, treat it exactly as if the user sent this message:

> Update PROJECT_STATUS.md with everything we've accomplished today. Make it detailed enough that a brand-new Claude Code session can resume immediately without needing previous conversation history.

Carry out that instruction directly, from `Z:\Backup\websites\OneClickAnswers`:

1. Review the session: what changed and why, the files touched, the tools added or changed, staging deploys (version
   plus Version ID), whether `/BWEOCACheckpoint` ran, and the decisions made.
2. Update `PROJECT_STATUS.md` so it reads as a standalone briefing:
   - Refresh the top status line: current staging and production versions, and whether production has been deployed.
   - Keep the list of live tools and their URLs current.
   - Add a dated section for this session.
   - Keep the "Open items" list honest, and remove resolved items.
   - Say plainly if staging is ahead of or behind the last commit.
3. If the session found a new trap, record it in `CLAUDE.md` as well, since a dated log alone gets missed.
4. Stage `PROJECT_STATUS.md` (plus `CLAUDE.md` if changed) by name and commit. Push only if `git remote -v` shows a
   remote.
5. Report the commit hash and whether it was pushed or is local-only.

This skill does **not** build, deploy or bump versions (that's `/BWEOCACheckpoint`), and it never invents content to
make the status look finished.
