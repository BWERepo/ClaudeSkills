---
name: BWEFAQAll
description: Runs the FAQ Engine repository's end-of-work routine in one go - the checkpoint (tests and manual drift check) and then the end-of-session wrap-up. Use when the user says "checkpoint and wrap up", "finish up", or invokes /BWEFAQAll, in the FAQEngine repository.
---

# BWEFAQAll

Run `/BWEFAQCheckpoint` first. If any check fails, stop and report; do not wrap up over a failing check. If everything passes, run `/BWEFAQEnd`.
