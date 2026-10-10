---
name: BWESEOAudit
description: Full read-only SEO baseline audit of the current website project using the BWESEO engine — architecture, page inventory, metadata, sitemap/robots/canonicals, structured data, analytics/Search Console, conversion paths, trust/claims, local signals, performance and accessibility — written to docs/seo/SEO-BASELINE.md with Critical/High/Medium/Low findings. Use when the user says "SEO audit", "audit the site's SEO", "SEO baseline", or invokes /BWESEOAudit, in any website project.
---

> `$BWESEO_ENGINE` = the canonical BWESEO engine directory: `$BWESEO_ENGINE_HOME` if set, else the `path` in
> `~/.claude/bweseo/engine-location.json` (see `/BWESEOInstall`). Engine code lives in `$BWESEO_ENGINE/src`, methodology in
> `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`.

# BWESEOAudit

1. Project guard (`/BWESEO` Step 0).
2. Follow `$BWESEO_ENGINE/docs/methodology/baseline-audit.md` end to end, using the
   adapter named in `seo/seo-config.json` to locate things. Include the checks from
   `technical-seo.md`, `structured-data.md`, and — only if the business is location-dependent —
   `local-seo.md`.
3. Update `seo/content-inventory.json` so every public URL has an entry (don't remove planned or
   rejected ideas).
4. Record state (`docs/methodology/workflow-state.md`): every Critical/High/Medium finding also goes into the inventory's top-level
   `issues[]` — `{ id, title, severity, area (technical|schema|local|internal-links|content|legal|measurement),
   status: "open", needsApproval, blocking, pages, foundOn, source: "docs/seo/SEO-BASELINE.md §…" }`.
   Keep existing entries: don't reopen a `fixed` / `verified` / `deferred` / `wont-fix` issue
   unless the evidence shows it's back; mark one `verified` (+ `verifiedOn`) when production
   confirms the fix. A finding already tracked by a roadmap page entry stays on that entry.
5. Write/replace `docs/seo/SEO-BASELINE.md` (keep a dated "History" section listing previous
   baselines). Cite file:line / URL evidence for every finding.
6. Run `node seo/tools/validate-seo-data.mjs` and the project's test command if the inventory
   changed.
7. Report the findings by severity and the recommended fix order. **Change nothing on the site**;
   fixes happen only after the user approves them, through the project's normal workflow.
