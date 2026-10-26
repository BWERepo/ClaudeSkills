# BWESEO Engine

The canonical, reusable, versioned SEO engine behind the `/BWESEO…` Claude Code skills.

> For the complete command reference, SEO lifecycle, installation instructions, Google workflow, troubleshooting,
> and operating procedures, see **[BWESEO-SKILLS-AND-PROCEDURES.md](BWESEO-SKILLS-AND-PROCEDURES.md)**.
>
> To use and maintain the engine by hand from a terminal, without Claude, follow
> **[docs/OPERATING-GUIDE.md](docs/OPERATING-GUIDE.md)**. To read it in the terminal, run `npm run guide` from this folder.

This repository is the canonical engine source. It can be checked out anywhere: a machine finds it through `BWESEO_ENGINE_HOME`
(see **Locating the engine**). Current version: see `VERSION` (engine), `engine-manifest.json` (schema and manifest versions).

## What BWESEO is

A customer-acquisition SEO workflow for small-business websites: a **state machine** that reads a project's real SEO
state and recommends one next step, **validators**, a **Google / Search Console workflow**, a **post-publication
checker**, an **installer**, and a set of Claude skills. It answers "what searches could bring this business a
*qualified* customer?", never mass-produces pages, and never invents facts. `/BWESEO` is the front door; you should
not need to memorize the other skills.

## Architecture

```
   this repository, wherever it is checked out   (canonical — authoritative; found via BWESEO_ENGINE_HOME)
   src · skills · schemas · templates · adapters · installer · docs · tests · scripts · engine-manifest.json
                    │
                    ▼   /BWESEOInstall  (allowlist manifest, scans, receipt)
   ┌────────────────┼────────────────┐
   ▼                ▼                ▼
 Website A       Website B       Website C     ← customer data lives ONLY here (seo/, docs/seo/)
```

- **Engine** (this folder): reusable code, schemas, templates, methodology, skills, adapters, installer, tests. No
  customer data. **Customer projects** are consumers: they receive allowlisted copies of engine files and keep their
  own profile, configuration, inventory, lifecycle/health history, Search Console and analytics state.
- **Lifecycle vs live health are independent.** A failed availability check (5xx, Cloudflare 522, timeout, DNS…)
  never reverses a completed lifecycle milestone.
- **Google stages are separate facts.** Published ≠ discovered ≠ crawled ≠ indexed; indexing requested, sitemap success
  and a passed Live URL Test never mean indexed.
- **Environments:** local / staging / preview / production. Staging is never submitted to search engines.

## Quick install

From the customer's website project, in Claude Code:

```
/BWESEOInstall --dry-run     review the plan (changes nothing)
/BWESEOInstall               install the engine
/BWESEOInstall --verify      confirm (changes nothing)
/BWESEOSetup                 record the customer's own facts
/BWESEO                      follow the state-aware recommendation
```

## Locating the engine

**`BWESEO_ENGINE_HOME` is the canonical way to tell any tool or skill where this engine is checked out.** Set it to the
directory that contains `VERSION` and `engine-manifest.json`:

```
# macOS / Linux / Claude Project / cloud thread
export BWESEO_ENGINE_HOME=/path/to/SEOEngine

# Windows PowerShell, this session
$env:BWESEO_ENGINE_HOME = "<path to the SEOEngine checkout>"

# Windows, permanently
setx BWESEO_ENGINE_HOME "<path to the SEOEngine checkout>"
```

Where the checkout lives is **local configuration, not a requirement of this repository**. (`BWESEO_ENGINE` is accepted as an
alias.) As a convenience on a developer machine, `node scripts/register-engine.mjs` records the location in
`~/.claude/bweseo/engine-location.json`; the variable always wins over the recorded location. `/BWESEOInstall --verify` shows how
the engine was found.

## Using the engine from a Claude Project or cloud thread

See **[docs/CLOUD-SETUP.md](docs/CLOUD-SETUP.md)** — clone, `npm ci`, `BWESEO_ENGINE_HOME`, `--sync-skills`, and the
repository-local skills setup.

## Updating

```
/BWESEOInstall --dry-run --update
/BWESEOInstall --update
/BWESEOInstall --verify
```

Updates engine files only. The customer's profile, configuration, inventory, lifecycle, health, Search Console,
analytics, research and reports are preserved; a schema migration is backed up, validated and rolled back on failure.

## Verifying

- Website: `/BWESEOInstall --verify` (installed? versions? manifest integrity? leakage? next action).
- Engine: `node scripts/validate-canonical.mjs --run-tests` reports **CANONICAL ENGINE READY** or **NOT READY**.

## Security

- The manifest is an **allowlist**: only explicitly classified files are ever installed (default deny; an unclassified
  file fails the build).
- Every payload is scanned for secrets (keys, tokens, verification values, environment values) — by category only,
  never printing a value — and aborts the install if anything is found.
- Credentials never live in a repository: configuration holds a *name* only.
- No network, deploy, commit, push, DNS or Google call happens during installation.
- Hashes (`engine-manifest.json`, the installation receipt) detect missing, modified or tampered files.

## Customer isolation

No customer's business facts, domains, URLs, keywords, competitors, Search Console, analytics, lifecycle, health or
monitoring data may exist in the engine or cross into another project. The project-identity scan compares every
payload against the identities registered on the machine (`~/.claude/bweseo/registry.json`, fingerprints only), and
permanent tests install into two fictional projects in both directions and check that neither contains the other.

## Versioning

`engineVersion` (this engine, `yyyy.mm.dd.nn` — `VERSION`), `schemaVersion` (the shape of a project's data files) and
`manifestVersion` are independent of each other and of any website's version. Bump the engine version for any
behavior change; bump the schema version only when a data file's shape changes (and add a migration).

## Development

```
npm ci                            install the test tooling from the lockfile
npm test                          engine + installer + canonical tests
npm run check:generated           verify the manual, guide and manifest are current (changes nothing; pull requests run this)
npm run guide                     print the operating guide (add -- <section>, -- --list, or -- --check for drift)
node scripts/build-manifest.mjs   rebuild engine-manifest.json after ANY engine file change (--check to verify)
node scripts/build-manual.mjs     regenerate the manual   (--check to verify)
node scripts/validate-canonical.mjs --run-tests
```

Two runtimes: working on this repository (the test runner) needs Node 20.19+ or 22.12+; the engine itself, once installed in a website or a Worker,
keeps its zero-dependency Node 18+ support. Pull requests are validated by `.github/workflows/pr-validation.yml`.

The engine's own maintenance skills (`/BWESEOBegin`, `/BWESEOCheckpoint`, `/BWESEOEnd`, `/BWESEOAll`, `/BWESEORelease`) are repository-local:
they live in `.claude/skills/` in this repository and load automatically when Claude Code is opened here.

Workflow: change the engine here → tests → security/leakage scan → version → manifest → disposable installation test →
`/BWESEOInstall --dry-run --update` in a website. Customer projects never write back into this folder.

## Backup / recovery

This folder is the **working source**. Keep it under version control (its own Git repository, kept separate from any
website's history) and back it up independently of the machine it is checked out on. To recover: clone or restore it, run `node scripts/validate-canonical.mjs --run-tests`, then
`node scripts/register-engine.mjs`, then `/BWESEOInstall --verify` in each website.
