---
name: BWEWorkQueue
description: Lists the ENTIRE work queue of the One Click Answers project (Z:\Backup\websites\OneClickAnswers\docs\QUEUE.md) as one table with the item number, a short description and the status of every item, plus the deploy and e2e switches. Use when the user says "show queue", "list the work queue", "what is in the queue", or invokes /BWEWorkQueue, in the context of the One Click Answers project.
---

# BWEWorkQueue

> **Where it runs (local or cloud):** `Z:\Backup\websites\OneClickAnswers` below is the owner's local Windows checkout and is optional. In any other checkout (a cloud Claude Code project, Linux or macOS) use the repository root, the folder that holds `CLAUDE.md`; nothing in this skill needs the `Z:` drive. See docs/CLAUDE-PROJECT-MIGRATION.md.

Show the complete queue, every item from the first to the last, not just the open ones.

## Do
1. Work in `Z:\Backup\websites\OneClickAnswers`. Read `docs/QUEUE.md` with the Grep tool: search for lines matching `^## ` (the item headings; some items have letters such as `42b`). Do not read the whole file: the headings carry the number, the title and the status in their trailing parentheses (for example "BUILT on staging", "BUILT in code, NOT deployed", "queued, NOT started", "SKIPPED"). If an item has no status words in its heading, grep its first few lines for "BUILT", "NOT started", "SKIPPED" or "DONE" before deciding.
2. Build ONE table with every item in numeric order:
   | # | Description | Status |
   - **#**: the item number exactly as in the file (keep `42b` style numbers as their own row).
   - **Description**: the heading's title reduced to a plain-English line of about 12 words or fewer. Drop the dates, the "owner request/prompt" wording and the status parentheses.
   - **Status**: one of **Built, on staging vX** (when the heading names a staging version), **Built, deployed to production** (only when the heading or PROJECT_STATUS.md says it was released), **Built in code, not deployed**, **Not started**, **Skipped / rejected**, or **In progress** (an agent or Claude is working on it right now; check the conversation and `ListAgents`). Use the words of the heading; never promote an item to "built" without the heading saying so.
3. Do NOT trust a "NOT started" or "BUILT" label blindly when it is old: a status can lag the code (the project notes record items marked "NOT started" that were already built, and items whose commits only added the queue entry). For any item whose label looks doubtful, make ONE quick check (`git log --oneline -3 -- <likely file>` or a Grep for its main file named in the item) and say "(label may be stale)" instead of guessing.
4. Under the table, report the two switches by checking whether the files exist in the project root: **Deploy: ENABLED/DISABLED** (`.deploy-disabled` exists = disabled) and **E2E: ENABLED/DISABLED** (`.e2e-disabled` exists = disabled).
5. Finish with one line: how many items are built, how many are not started, and which one(s) are in progress.

## Do not
- Do not edit any file, build, deploy or run tests.
- Do not invent items, numbers or statuses; if a heading is unclear, say so in the Status cell.
- Do not paste item bodies; the table is the whole answer.
