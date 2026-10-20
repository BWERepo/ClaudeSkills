---
name: BWESEOBegin
description: Start-of-session resume for the BWESEO engine source repository — reads PROJECT_STATUS.md and continues development from where the last session left off. Use when the user says "let's continue", "pick up where we left off", "start of session", or invokes /BWESEOBegin, in the context of the SEOEngine repository (the BWESEO engine source, not a customer website).
---

# BWESEOBegin

When invoked, treat it exactly as if the user sent this message:

> Read PROJECT_STATUS.md in the SEOEngine repository root and continue development from where we left off.

**Repository root:** the directory that contains `VERSION`, `engine-manifest.json` and `scripts/validate-canonical.mjs`. Normally that is
the current working directory; if it is not, use `$BWESEO_ENGINE_HOME`. Never assume a drive letter or a fixed path. If neither
locates the engine repository, say so and stop.

From the repository root: read `PROJECT_STATUS.md`, orient on the current state (recent work, known issues, pending tasks), also read
`README.md` and `VERSION`, run `git status` and `git log --oneline -5`, and resume accordingly. This project is the engine source, not a
website; customer projects never write back here.

If `PROJECT_STATUS.md` does not exist yet, say so, summarize the state from `README.md`, `VERSION` and git history, and ask what to
work on. If it is ambiguous what to do next, summarize the current state and ask rather than guessing.
