---
name: BWEFAQBegin
description: Start-of-session resume for the FAQ Engine source repository - reads PROJECT_STATUS.md and continues development from where the last session left off. Use when the user says "let's continue", "pick up where we left off", "start of session", or invokes /BWEFAQBegin, in the context of the FAQEngine repository (the engine source, not a customer website).
---

# BWEFAQBegin

When invoked, treat it exactly as if the user sent this message:

> Read PROJECT_STATUS.md in the FAQEngine repository root and continue development from where we left off.

**Repository root:** the directory that contains `package.json` (name `faq-engine`) and `src/cli.mjs`, normally the current working directory. Never assume a drive letter or a fixed path.

Read `PROJECT_STATUS.md`, `README.md` and `package.json`, run `git status` and `git log --oneline -5`, and resume accordingly. This repository is the engine source, not a website; customer
sites never write back here. If `PROJECT_STATUS.md` is missing, summarize the state from `README.md` and git history and ask what to work on.
