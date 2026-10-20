---
name: BWESEOAll
description: Full end-to-end wrap-up for the BWESEO engine source repository — runs BWESEOCheckpoint (manual/manifest, validation + tests, commit, push), then BWESEOEnd (PROJECT_STATUS.md). Takes an optional version number (e.g. /BWESEOAll 2026.10.19.01), passed through to the checkpoint. Use when the user says "do it all", "checkpoint and wrap up", or invokes /BWESEOAll, in the context of the SEOEngine repository.
---

# BWESEOAll

When invoked, treat it exactly as if the user sent this message:

> Run /BWESEOCheckpoint, then /BWESEOEnd, in that order.

Carry it out from the repository root (the directory containing `VERSION` and `engine-manifest.json`; normally the current working
directory, otherwise `$BWESEO_ENGINE_HOME`) without asking before each step (this invocation is the explicit go-ahead for both). This is
a pure sequencing wrapper: follow each skill's own SKILL.md exactly and don't restate their steps here.

- **Version:** optional `yyyy.mm.dd.nn` (reject anything else; nn is the two-digit release number of that day, starting at 01). If given, pass it to `/BWESEOCheckpoint`. If omitted, pass none — the engine
  version is not bumped automatically.
1. Invoke `/BWESEOCheckpoint [version]`. If validation or tests fail, **stop the chain**, report the failure, and do not run `/BWESEOEnd`.
2. Invoke `/BWESEOEnd`, including the checkpoint commit and engine version in the write-up.

Report once at the end: engine version, validation/test result, checkpoint commit hash, and `PROJECT_STATUS.md` commit hash — or which
stage failed and why.
