---
description: Shortcut for /BWESEOInstall --update. Updates the BWESEO engine files in the current website project from the canonical engine (engine only; the project's profile, config, inventory and state are never touched; conflicts are reported as REVIEW REQUIRED, never overwritten). Use when the user invokes /BWESEOInstallUpdate or says "update the SEO engine".
---

Invoke the `BWESEOInstall` skill via the Skill tool with args `--update`, and follow its instructions exactly (dry run first if the owner hasn't seen one this conversation; report conflicts and stop for the owner's decision; run `--verify` afterwards).
