---
name: BWESEOInstall
description: The standard way to install the reusable BWESEO engine into a new website project (and to update, verify or sync its Claude skills later). Installs ONLY the sanitized, versioned engine (tools, schemas, generic tests, generic docs) from the canonical BWESEO engine into the CURRENT project through an explicit allowlist manifest, scans the payload for secrets and for other customers' data before writing anything, creates empty data folders, .gitignore rules, a small installation receipt and a BWESEO-managed CLAUDE.md section — and never copies business facts, Search Console/analytics/health state, page lifecycle history or credentials. Modes - install (default), --dry-run (show exactly what would happen, change nothing), --verify (report, change nothing), --update (engine only; customer data preserved), --sync-skills (install/update the Claude skills from the canonical source). Use when the user says "install BWESEO", "add SEO to this site", "set up the SEO engine on a new site", "update the BWESEO engine", "verify the BWESEO install", or invokes /BWESEOInstall, in any website project.
---

# BWESEOInstall

> `$BWESEO_ENGINE` = the BWESEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

```
NEW WEBSITE → /BWESEOInstall → clean BWESEO engine → /BWESEOSetup → customer profile → /BWESEO → state-aware SEO workflow
```

Installation and onboarding are **separate phases**. This skill installs the reusable **engine** only. It never
creates or fills a customer's profile, domains, services, Search Console state, analytics, page state or
credentials — that is `/BWESEOSetup`'s job, from the customer's own facts.

**Direction of travel is one way:** `CANONICAL ENGINE → CUSTOMER PROJECT`. Nothing a customer project contains
ever flows back into the canonical engine, and this skill never edits the canonical engine.

## The canonical engine

The versioned engine directory bundled in this plugin (`engines/seo`, see `$BWESEO_ENGINE` above) with an `engine-manifest.json`:
`engineVersion`, `schemaVersion`, `manifestVersion` — **never** a website's version number. Layout:
`src/` (engine code, installed to `seo/tools/`), `schemas/` (installed to `seo/schema/`), `installer/`, `skills/`
(canonical skill sources), `templates/`, `adapters/`, `docs/` (methodology, industry guides), `tests/`, `scripts/`,
`config/`. Customer projects are *consumers*: they get copies of the allowlisted files, recorded in a receipt.

## Run it

From the customer's website project (open that project in Claude Code first). Do not use `--sync-skills`: this plugin already provides the skills, and copying them into `~/.claude/skills` would duplicate them. `--verify` may list those skills as missing from `~/.claude/skills`; that is expected here.


```
node "$BWESEO_ENGINE/installer/bweseo-install.mjs" [--dry-run | --verify | --update | --sync-skills] [--json]
```

Map the user's words to flags: **install** = no flag · **dry run** = `--dry-run` · **verify** = `--verify` ·
**update** = `--update` (`--dry-run --update` previews an update) · **skills** = `--sync-skills` (with `--dry-run` to
preview). Extra flags: `--allow-subdir` (only if the subfolder really is the website project), `--with-optional`,
`--engine <dir>`.

## Steps

1. **Confirm the target.** State the repo root, `git remote get-url origin`, and that this is the customer's
   website project (not the BWESEO engine directory, and not another customer's repository). If the working
   tree has uncommitted work, say so and recommend committing or backing it up first — do not commit for them.
   **Already installed?** If `seo/bweseo-install.json` exists and the user asked for a plain install (no flag, or
   "install"/"update BWESEO"), do not reinstall: say the engine is already installed (receipt version vs
   `$BWESEO_ENGINE/VERSION`) and run `/BWESEOUpdate` instead, following that skill's steps. Explicit modes
   (`--dry-run`, `--verify`, `--update`, `--sync-skills`) run exactly as asked.
2. **First customer installation → dry run first.** If this project has no `seo/bweseo-install.json` and is
   the first external/customer installation (or the user has not seen a dry run for this project in this
   conversation), run `--dry-run`, show the plan **verbatim**, and ask for approval before the real install.
3. **Install.** Run the installer. It (a) locates and verifies the canonical engine and its manifest,
   (b) scans the payload for secrets and for the identity of every registered project, (c) installs only
   allowlisted files, (d) creates empty `seo/`, `seo/data/`, `docs/seo/`, (e) adds `.gitignore` rules,
   (f) merges the BWESEO-managed section into `CLAUDE.md`, (g) writes the receipt `seo/bweseo-install.json`.
4. **If it refuses** (secrets found, project data found, manifest invalid, target ambiguous, incompatible
   version, unclear project identity on update…) report the **gate and the corrective action exactly as the
   installer printed them** and stop. Never work around a gate: do not edit the manifest, the engine, the scan
   patterns or the registry to make it pass. Never print a secret value.
5. **Conflicts** (an existing file that differs from the engine's, or that the customer modified since
   installing): the installer leaves them untouched and marks them **REVIEW REQUIRED**. Explain the difference
   and let the owner decide; never overwrite.
6. **Verify.** Run `--verify` after an install or update and show the result. It also reports whether the
   installed Claude skills differ from the canonical source.
7. **Skills.** The canonical source of every BWESEO skill is `$BWESEO_ENGINE/skills/<name>/SKILL.md`. If verify
   reports drift, run `--sync-skills --dry-run`, show it, and — with the owner's approval — `--sync-skills`. A skill
   that was edited by hand since the last sync is a conflict (REVIEW REQUIRED), never overwritten.
8. **Hand off.** After a successful install say exactly:

   > BWESEO engine installed successfully.
   >
   > No customer-specific SEO profile exists yet.
   >
   > Next recommended action: `/BWESEOSetup`

   Do **not** start `/BWESEOSetup` yourself, and do not assume the business name, domain, services,
   locations, conversion goals, Search Console property, analytics, hosting or staging domain.

## Modes

| Mode | What it does | Changes files? |
|---|---|---|
| install (default) | New install, or **adopt** an existing project: identical files are recorded, different ones are conflicts and left alone | yes — engine files, empty folders, `.gitignore`, managed CLAUDE.md section, receipt |
| `--dry-run` | Lists files to create / update / preserve / exclude, conflicts, migrations, `.gitignore` and CLAUDE.md changes, warnings and safety failures | **no** |
| `--verify` | Installed?, engine + schema version, required skills (and drift), engine files vs receipt, configuration / profile status, manifest integrity, secret + project-leakage checks, documentation version, update available, next action | **no** |
| `--update` | Updates the **engine only** (files whose current content equals what the receipt installed). Runs schema migrations with backup → validate → roll back on failure | engine files, receipt, managed section only |
| `--sync-skills` | Installs / updates the Claude skills from the canonical source; records what it installed | the Claude skills directory only |

## What is installed, and what never is

The engine's manifest is an **allowlist** (default **DENY**). Every file is classified `ENGINE`, `TEMPLATE`,
`OPTIONAL`, `TEST` or (canonical development records) `DEV`; an unclassified file is an error, never a silent copy.

- **Google Index Monitoring (engine 1.9.0)** installs as ordinary engine files: `gsc-client.mjs`, `index-monitor.mjs`, `index-monitor-run.mjs`, `seo-google-index.mjs` (+ tests). It copies **no** site data: no property, URLs, KV ids or keys. After installing, the site adds its OWN `analytics.searchConsole.indexMonitor` config, its OWN adapter (discover / store / scheduled handler / admin screen), its OWN Google service account and secret — see `docs/methodology/google-index-monitoring.md` → "Installing on another website". `--update` refreshes the engine files only; the site's adapter, config and stored monitor data are never touched.
- **Keyword Performance System (engine 1.10.0)** installs as ordinary engine files: `keyword-registry.mjs`, `keyword-target.mjs`, `keyword-performance.mjs`, `keyword-performance-run.mjs`, `seo-keywords.mjs` (+ types and tests) and the schema additions (`pages[].keywords`, `keywordDecisions`, `analytics.searchConsole.keywordPerformance`). It copies **no** keywords, Search Console or analytics data, history, sitemap data or credentials from any website. After installing, the site adds its OWN `keywordPerformance` config, registers its OWN keywords in its OWN `seo/content-inventory.json`, and uses its OWN Search Console property and service account - see `docs/methodology/keyword-performance.md` -> "Installing on another website". `--update` refreshes engine files only; the site's keywords, decisions, config and stored data are never touched. `--verify` reports whether the keyword tools are present.
- **Installed into a project:** `seo/tools/*.mjs` (+ types and the co-located generic tests), `seo/schema/*.json`,
  a generic `docs/seo/README.md` shell (never over an existing file).
- **Stays in the canonical engine** (read from there): methodology, adapters, industry guides, templates, the installer, the skills' sources.
- **Never copied, never overwritten:** business profile, `seo-config.json`, content inventory, page
  lifecycle, Search Console / sitemap / Google / analytics / health state, opportunities, roadmap, competitors,
  keyword research, reports, monitoring data, exports, credentials, tokens, `.env*`, other customers' anything.

`.gitignore` classification: **versioned config** `seo/seo-config.json`, `seo/business-profile.json`; **versioned safe
state** `seo/content-inventory.json`, `seo/bweseo-install.json`, `docs/seo/**`; **runtime data (ignored)** `seo/data/`;
**private (ignored)** `seo/sources/`, `seo/.bweseo-backup/`; **secrets** never in the repo.

## Adapters

The installer detects the framework (Astro, Next.js, TanStack Start, React Router SPA, Vite SPA, WordPress, PHP,
static HTML) and records an adapter **only if the engine ships one**. Otherwise it installs the core engine and
reports **"Website adapter requires configuration"** — an adapter is never fabricated. Existing sitemap / robots
implementations are reported and never touched.

## Never

Deploy, push, commit (unless the owner asks), change DNS / Cloudflare / hosting / Search Console / analytics,
submit a sitemap, request indexing, create external accounts, send email, publish content, install into a
project the owner did not open, overwrite a customer file, copy anything from a customer project into the
canonical engine, or print a token, key or password.

## Developing the canonical engine (maintainers only)

A separate, explicitly approved process — never part of installing into a customer: change the engine in its own
repository → bump `VERSION` (and `SCHEMA_VERSION` only if stored data must migrate; keep `ENGINE_VERSION` in
`src/validate-seo-data.mjs` equal) → run the engine tests → `node scripts/build-manifest.mjs` (refuses unclassified
files) → `node scripts/validate-canonical.mjs` (secret scan, project-data scan against every registered identity,
manifest integrity, skills) → then in a customer project `--dry-run --update`, `--update`, `--verify`.
`--register-project` (run in a configured project) records that project's identity fingerprints on this machine so
no engine build can ever carry them into another customer.
