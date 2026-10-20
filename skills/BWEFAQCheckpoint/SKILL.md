---
name: BWEFAQCheckpoint
description: Verification checkpoint for the FAQ Engine source repository - runs the tests and the manual drift check, rebuilds nothing silently, and reports the real results. Use when the user says "checkpoint", "run the checks", "is the engine healthy", or invokes /BWEFAQCheckpoint, in the FAQEngine repository.
---

# BWEFAQCheckpoint

From the FAQEngine repository root, in this order:

1. `npm test` (Node's built-in test runner; no install step). Report the real pass/fail counts.
2. `npm run guide -- --check`. It fails when the user manual and the engine disagree (commands, flags, scripts, skills). If it fails, update `docs/USER_MANUAL.md` in the same change.
3. `git status`: say plainly what is uncommitted.

Report the results exactly as they came out. Do not skip a failing check, do not edit tests to make them pass, and do not commit unless asked.
