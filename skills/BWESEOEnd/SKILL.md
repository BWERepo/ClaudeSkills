---
name: BWESEOEnd
description: End-of-session wrap-up for the BWESEO engine source repository — updates (or creates) PROJECT_STATUS.md with everything accomplished in the current session, then commits and pushes it, written so a brand-new Claude Code session can resume with no prior context. Use when the user says "wrap up", "end of session", "update project status", or invokes /BWESEOEnd, in the context of the SEOEngine repository.
---

# BWESEOEnd

When invoked, treat it exactly as if the user sent this message:

> Update PROJECT_STATUS.md with everything we've accomplished today. Make it detailed enough that a brand-new Claude Code session can resume immediately without needing previous conversation history.

**Repository root:** the directory that contains `VERSION`, `engine-manifest.json` and `scripts/validate-canonical.mjs` — normally the
current working directory, otherwise `$BWESEO_ENGINE_HOME`. Never assume a drive letter or a fixed path. Carry out the instruction there:

1. Review the conversation for everything accomplished: engine changes, skills added/changed (the repository's `skills/` and
   `.claude/skills/` vs the user-level copies), version/manifest state, decisions made (call out any that reversed earlier
   assumptions — a cold-start session needs the *current* truth), and what is still open.
2. Update `PROJECT_STATUS.md`; if it doesn't exist, create it as a standalone briefing: purpose of the project, the repository remote
   and branch (`git remote get-url origin`), current engine version, how to run tests/validation (see README "Development"), skills
   list, then a "Last updated" line and dated session sections (newest first), then known follow-ups (only genuinely open items).
   Write no machine-specific paths and no customer names or data: this file is committed. If this session changed anything a person
   runs or follows and `docs/OPERATING-GUIDE.md` was not updated, update it too and say so.
3. Stage `PROJECT_STATUS.md` by name (plus files clearly part of this doc update; never sweep in unrelated pending work; rebuild the
   manifest first, because it records this file's hash), commit in the repository's style, and push to the current branch's remote
   if one exists.
4. Report the commit hash. This skill does not run tests or the checkpoint; if uncommitted engine work is still sitting locally, say so
   plainly.
