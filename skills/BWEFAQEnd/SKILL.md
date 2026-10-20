---
name: BWEFAQEnd
description: End-of-session wrap-up for the FAQ Engine source repository - updates (or creates) PROJECT_STATUS.md with everything accomplished in the session so a brand-new session can resume with no prior context, then commits it. Use when the user says "wrap up", "end of session", "update project status", or invokes /BWEFAQEnd, in the FAQEngine repository.
---

# BWEFAQEnd

When invoked, treat it exactly as if the user sent this message:

> Update PROJECT_STATUS.md with everything we've accomplished today. Make it detailed enough that a brand-new Claude Code session can resume immediately without needing previous conversation history.

1. Review the conversation: engine changes, skills added or changed, decisions (call out any that reversed earlier assumptions), and what is still open.
2. Update `PROJECT_STATUS.md` (create it if missing): purpose, repository remote and branch, engine version (`package.json`), how to run tests and the guide check, the skills list, a "Last
   updated" line, dated session sections (newest first), and genuinely open follow-ups. No machine paths and no customer names or data: the file is committed.
3. If anything a person runs or follows changed and `docs/USER_MANUAL.md` was not updated, update it too and say so.
4. Stage `PROJECT_STATUS.md` by name (plus files clearly part of the doc update), commit in the repository's style, and push to the current branch's remote if one exists.
5. Report the commit hash. This skill does not run tests; if uncommitted engine work remains, say so.
