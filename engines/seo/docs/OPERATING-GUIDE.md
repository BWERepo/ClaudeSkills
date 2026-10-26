# BWESEO Engine — Operating Guide

A step-by-step guide for a person to use and maintain the BWESEO engine **from a terminal, without Claude**. Every command below is
an ordinary `node`, `npm` or `git` command. Where a Claude skill (`/BWESEO…`) exists for a task, the guide names it, so you can use
either route.

What you need: **Git**, **Node.js** (includes `npm`) and read access to this repository. Using the engine or installing it into a website needs
Node 18 or newer. Working ON this repository (running its tests) needs Node 20.19+ or 22.12+, because the test runner requires it (`engines` in `package.json`).

To read this guide in a terminal, run from the engine folder:

```
npm run guide                    # the whole guide
npm run guide -- 8               # one section, by number or by a word in its heading (e.g. -- troubleshooting)
npm run guide -- --list          # the section headings
```

On GitHub, without a checkout: open the repository's **Actions** tab, choose **Show operating guide**, press **Run workflow**
(optionally type a section number or word), then open the finished run. The guide is shown on the run's summary page.

To read the user manual as a web page: the **Show user manual** workflow shows it on the run page and attaches it as a downloadable HTML artifact (`bwe-seo-user-manual`) on every push to `main` (or press **Run workflow**); open the run in the Actions tab. It needs no GitHub Pages, so it works in a private repository.

Contents

1. What the engine is
2. Get the engine and tell your machine where it is
3. Check the engine is healthy
4. Install the engine into a website
5. Set up a website's SEO data by hand
6. Everyday tools inside a website
7. Update a website to a newer engine
8. Maintain the engine itself (change, rebuild, validate, commit)
9. Rules that always apply
10. Troubleshooting
11. Where to read more

---

## 1. What the engine is

This repository is the **engine source**: reusable, customer-neutral SEO code (a state machine, validators, a Google / Search
Console layer, a post-publication checker), JSON schemas, templates, methodology documents, an installer, and the `/BWESEO…` skills.

- It is **not a website** and is never deployed.
- The installer copies an allowlisted set of engine files **into** a website project (`seo/tools/`, `seo/schema/`, `docs/seo/`).
- Customer data (business facts, pages, keywords, Search Console and analytics data) lives **only** in each website's own `seo/`
  and `docs/seo/` folders. It never comes back into this repository.

## 2. Get the engine and tell your machine where it is

```
git clone https://github.com/BWERepo/SEOEngine.git SEOEngine
cd SEOEngine
npm ci          # installs the test runner only; needed for tests and maintenance, not for installing into a website
```

Every tool finds the engine through the environment variable **`BWESEO_ENGINE_HOME`**: the folder that contains `VERSION` and
`engine-manifest.json`.

```
# macOS / Linux (current terminal)
export BWESEO_ENGINE_HOME="$PWD"

# Windows PowerShell (current session)
$env:BWESEO_ENGINE_HOME = (Get-Location).Path

# Windows, permanently (open a new terminal afterwards)
setx BWESEO_ENGINE_HOME "<path to the SEOEngine folder>"
```

Optional on a machine you keep: `node scripts/register-engine.mjs` records the location in your home folder so tools can find it
even when the variable is not set. `node scripts/register-engine.mjs --check` shows which engine would be used and how it was found.
The variable always wins.

## 3. Check the engine is healthy

From the engine folder:

```
node scripts/validate-canonical.mjs --run-tests
```

The last line must say **`Canonical engine: READY`**. It runs the full test suite and checks the manifest hashes, secret leakage and
customer-identity leakage. `npm test` runs the tests alone.

## 4. Install the engine into a website

Run these from the **website project's root folder** (Claude route: `/BWESEOInstall`).

```
node "$BWESEO_ENGINE_HOME/installer/bweseo-install.mjs" --dry-run    # shows exactly what would happen; changes nothing
node "$BWESEO_ENGINE_HOME/installer/bweseo-install.mjs"              # installs
node "$BWESEO_ENGINE_HOME/installer/bweseo-install.mjs" --verify     # reports on the installation; changes nothing
```

(Windows PowerShell: write the path as `"$env:BWESEO_ENGINE_HOME\installer\bweseo-install.mjs"`.)

What the install does: creates `seo/tools/`, `seo/schema/`, `seo/data/` and `docs/seo/`, writes a receipt `seo/bweseo-install.json`,
adds `seo/data/` and similar private folders to `.gitignore`, and adds a BWESEO section to the site's `CLAUDE.md`. It makes no network
call, no commit, no deploy and no Google change. It refuses to run if its secret or isolation scan finds anything.

Useful options: `--project <dir>` (install into another folder), `--engine <dir>` (use this engine checkout instead of
`BWESEO_ENGINE_HOME`), `--json` (machine-readable output), `--with-tests` (also copy the tests), `--with-optional` (also copy files the
manifest marks optional), `--allow-subdir` (the website really is a subfolder of a larger repository). Exit codes: `0` ok, `1` refused or problems found, `2` finished but **REVIEW REQUIRED**, `3` usage error.

Maintainer flags: `--register-project` records the current website's identity fingerprints on this machine (used by the leakage
scans; run it once per website), `--register-engine` records where the engine lives (the same as `scripts/register-engine.mjs`), and
`--build-manifest` rebuilds `engine-manifest.json` (the same as `scripts/build-manifest.mjs`).

`--verify` also reports whether the Claude skills are installed. If you only work by hand you can ignore that line. To install the
skills for Claude users: `node "$BWESEO_ENGINE_HOME/installer/bweseo-install.mjs" --sync-skills --dry-run`, then the same without
`--dry-run`.

**One command instead:** `node <engine>/scripts/bootstrap.mjs --dry-run` (from the website's folder, or with `--project <dir>`) previews, and the
same without `--dry-run` installs the engine, syncs the skills into the website's `.claude/skills` and verifies. It finds the engine from its own
location, so `BWESEO_ENGINE_HOME` need not be set. Add `--user-skills` to put the skills in `~/.claude/skills` instead. It stops at the first failing step.

## 5. Set up a website's SEO data by hand

Claude route: `/BWESEOSetup`. By hand, copy the three templates from the engine into the website and fill them in:

```
cp "$BWESEO_ENGINE_HOME/templates/seo-config.template.json"        seo/seo-config.json
cp "$BWESEO_ENGINE_HOME/templates/business-profile.template.json"  seo/business-profile.json
cp "$BWESEO_ENGINE_HOME/templates/content-inventory.template.json" seo/content-inventory.json
```

| File | What goes in it |
|---|---|
| `seo/seo-config.json` | The project id, the site's stack, its environments (local, staging, production hosts), sitemap, Search Console property. Credentials are given by **name only** (for example an environment-variable name), never the value. |
| `seo/business-profile.json` | Verified facts about the business, each with where the fact came from. Never invent a fact. |
| `seo/content-inventory.json` | Every page of the site: id, path, purpose, status, and (optionally) its target keywords. |

The JSON Schemas in `seo/schema/` describe every field. Check your work with:

```
node seo/tools/validate-seo-data.mjs       # exit code 0 = valid; errors name the file and field
```

## 6. Everyday tools inside a website

All of these run from the website root and **read** the project's data. Commands that change something say so.

| Task | Command | Claude route |
|---|---|---|
| What state is SEO in, and what is the one next step? | `node seo/tools/seo-state.mjs` (add `--offline` to skip live checks, `--details` for everything, `--page <id or /path>` for one page) | `/BWESEO` |
| Validate the SEO data files | `node seo/tools/validate-seo-data.mjs` | — |
| Is a published page live, indexable and correct? | `node seo/tools/post-publish-check.mjs --id <page-id>` (or `--url <url>`; `--env staging` to test staging) | `/BWESEOPublish` |
| Google readiness, sitemap, index evidence, performance | `node seo/tools/seo-google.mjs api-status` · `readiness <id>` · `sitemap` · `inspect <id>` · `performance <id>` | `/BWESEOSearchConsole` |
| Google index monitoring snapshot | `node seo/tools/seo-google-index.mjs pull` · `status` · `investigate` · `explain <path>` | `/BWESEOSearchConsole index …` |
| Keyword → page registry and keyword performance | `node seo/tools/seo-keywords.mjs validate` · `list` · `status` · `analyze "<keyword>"` · `table` · `page <path>` · `investigate` | `/BWESEO keyword <phrase>` |
| Google Business Profile builder (manual mode): eligibility, duplicate check, draft, schema, website audit, approval, verification | `node seo/tools/seo-local-gbp.mjs status` · `questions` · `eligibility --answers a.json --by "<name>"` · `discover --method "<where>" --by "<name>"` · `draft --init` · `check` · `schema` · `audit --html page.html` · `approve --by "<name>"` · `created --by "<name>"` · `verification --status pending-owner-action --by "<name>"` · `recommend` · `queue --sync` · `reviews --unanswered` · `review-request` · `posts --suggest` · `performance` | `/BWESEOLocal gbp` |
| Landing pages: import keywords, plan new-vs-improve, run the quality gate, approve | `node seo/tools/seo-landing.mjs import <csv>` · `add "<keyword>"` · `plan --pages site-pages.json` · `status` · `check <id> --page page.json` · `approve <id> --by "<name>"` · `move <id> --to <status>` | `/BWESEOLanding` |
| City landing pages: register a city, research brief, draft + checks, release package (sitemap/robots/links), approve, record published, verify live | `node seo/tools/seo-landing-city.mjs add "<City>" <ST>` · `brief <id> --file brief.json` · `draft <id> --page page.json` · `status` · `package --origin <url> --sitemap sitemap.xml --robots robots.txt` · `approve --package <hash> --by "<name>"` · `published <id> --by "<name>"` · `verify --origin <url>` | `/BWESEOLanding` |
| Unified improvement queue: one prioritized list across audits, keywords, Google Business Profile, landing pages and regression reports; the next eligible action | `node seo/tools/seo-queue.mjs build` (add `--regression report.json`) · `list` (add `--status`, `--category`, `--json`) · `next` · `explain <id>` · `decide <id> --to <status> --by "<name>"` · `assign <id> --owner "<name>" --by "<name>"` | `/BWESEO` |
| Change-to-outcome history: record a page change, then compare complete before/after periods from saved daily rows | `node seo/tools/seo-outcomes.mjs record <id> --page /path --category content --published 2026-09-01 --by "<name>"` · `list` · `due` · `compare <id> --rows rows.json` · `review <id> --rows rows.json --review-date 2026-10-01 --by "<name>"` | — |
| Google search monitoring workflow (on by default): keep the sitemap current from page events, a daily check of new pages plus a rotating sample, flags for not-indexed pages, crawl failures and unexpected canonicals, a weekly report with the three most useful fixes | `node seo/tools/seo-watch.mjs status` · `enable --by "<name>"` · `disable --by "<name>"` · `notify </path> --event published` (events are published, changed or removed; add `--lastmod 2026-10-26`, `--canonical <url>`, `--noindex`) · `seed --sitemap public/sitemap.xml` · `sync` (add `--dry-run`, `--allow-shrink`) · `daily` (add `--no-inspect`) · `weekly` (add `--rows rows.json`, `--today 2026-10-26`) · `findings` | `/BWESEOSearchConsole` |
| Diagnostics for this project: installation, configuration, runtime, adapter, credentials (by name), stored-data age, last recorded scheduler success | `node seo/tools/seo-doctor.mjs` (add `--json`, `--max-age-days 14`) | — |
| Run the page checks on a saved page (og:url vs canonical, social image size, visible H1, shared navigation) | `node seo/tools/seo-page-checks.mjs --html page.html --url <url>` (add `--home home.html`, `--public-dir public`) | — |
| Whole-site indexing-readiness checks on production (http/www redirects, robots.txt per host, sitemap sweep, redirect codes, blocked + noindex pages, key-page links, image weight, demo hosts) | `node seo/tools/seo-site-checks.mjs` (add `--demo-host <host>`, `--key-page </path>`, `--max-pages <n>`, `--json`) | `/BWESEOTechnical` |
| SEO regression detection: compare a saved observation with the accepted baseline (noindex, robots.txt, canonicals, errors, redirects, sitemap, broken links, orphans), list and explain findings, initialize or accept a baseline, record approved changes | `node seo/tools/seo-regression.mjs status` · `compare --observation obs.json` · `findings` · `explain <finding-id>` · `read-model` · `init --observation obs.json --by "<name>"` · `accept --observation obs.json --by "<name>" --reason "<why>"` · `record --observation obs.json` · `decision <finding-id> --state wont-fix --by "<name>"` · `exception add --kind redirect --url </path> --expect-target </new> --reason "<why>" --by "<name>"` · `observe --env production --out obs.json` | `/BWESEOTechnical` |
| Record this run's live-site health | `node seo/tools/seo-state.mjs --record-health` (writes `seo/data/live-health.json` only) | — |

Commands that **change** files or call Google:
- `seo-local-gbp.mjs eligibility` / `discover` / `draft` / `approve` / `created` / `verification` / `recommend` / `reviews` / `posts` / `performance` write only `seo/data/local-gbp/`; `queue --sync` also adds `gbp-…` entries to `seo/content-inventory.json` (running it is your approval); none calls Google or changes the website, and creating or verifying a profile is the owner's own action in Google's interface.
- `seo-landing-city.mjs` writes only `seo/data/landing/cities.json` and `docs/seo/reports/city-*.json`; it never deploys, publishes, redirects or submits to Search Console. `approve` binds to one release-package hash (any later change voids it), `published` only records that you deployed, and `verify` makes read-only requests to the live site.
- `seo-landing.mjs` writes only `seo/data/landing/`; it never publishes, and `approve` records approval of the exact publish content only (path, canonical, structured data, links, images, indexability and the text); change any of it and the approval is void. An approval recorded by an older version is shown as "legacy" and must be repeated. `plan` keeps drafts, checks and approvals when it re-plans (see `docs/methodology/landing-pages.md`). Saves are atomic and one command at a time: a second terminal is told to try again.
- `seo-queue.mjs build` writes only `seo/data/improvement-queue.json` and changes none of the records it reads; `decide` and `assign` write only that file, and a person's decision (approved, in-progress, deferred, wont-fix) is never overwritten by a later `build`. An item is marked resolved only when a complete run of the check that found it no longer reports it; a failed or partial run leaves it unchanged and marks it unconfirmed. Details: `docs/methodology/improvement-queue.md`.
- `seo-outcomes.mjs record` and `review` write only `seo/data/outcomes.json`; `compare`, `list` and `due` are read-only. A comparison shows what differed between two periods; it never states that the change caused it. Details: `docs/methodology/change-outcomes.md`.
- `seo-watch.mjs`: `status`, `findings` are read-only; `enable` / `disable` edit only `analytics.searchConsole.searchWatch.enabled` in `seo/seo-config.json`; `notify`, `seed`, `sync`, `daily` and `weekly` write only `seo/data/search-watch/`, and `sync` also rewrites the sitemap file named by `searchWatch.sitemapPath` (atomically, only when it changes, refusing to drop more than `maxShrinkPercent` of it unless you pass `--allow-shrink`). Only `daily` (and `weekly` without `--rows`) make network requests: read-only GETs of the site's own production pages and the official Search Console API with the credential named in the configuration. "Not indexed" comes only from Search Console URL Inspection. It never requests indexing, submits a URL or deploys. Installing the engine turns it on; `disable` turns it off. Details: `docs/methodology/search-watch.md`.
- `seo-doctor.mjs` is read-only: it makes no network call and no live authentication, shows credentials by name only, and reports scheduler success only as recorded in the project's own files.

- `seo-regression.mjs`: `status`, `compare`, `findings`, `explain`, `read-model`, `issues` and `exception list` are read-only. `init`, `accept`, `record`, `decision` and `exception add` / `remove` write only `seo/data/regression/` (atomic, one at a time, history and an audit trail kept); `accept` is refused while unresolved regressions exist unless you add `--acknowledge-regressions`. `observe` makes read-only requests to the site's own pages and saves an observation file, never a baseline. It reports observed technical state, never Google's indexing status (see `docs/methodology/regression-detection.md`). Exit codes of `compare` and `record`: `0` no actionable regression (or no baseline yet), `1` regressions detected, `2` not comparable, `3` usage error or failure.
- `seo-keywords.mjs add` / `remove` edit `seo/content-inventory.json`; running them is your approval.
- `seo-keywords.mjs refresh` and `seo-google.mjs sitemap --submit` call Google's official Search Console API and need the credential
  named in `seo-config.json` to be set in the environment.
- Nothing ever requests indexing or submits a staging URL.

Exit codes of `post-publish-check.mjs`: `0` ready, `1` action required, `2` page not live, `3` usage or configuration error,
`4` not applicable (local).

The creative work (audit, opportunities, content plans, writing pages, schema, internal links, reports) is done with the Claude skills.
Their procedures, the human approval gates and the troubleshooting tables are written out in full in
[BWESEO-SKILLS-AND-PROCEDURES.md](../BWESEO-SKILLS-AND-PROCEDURES.md), so a person can follow them by hand.

## 7. Update a website to a newer engine

Claude route: `/BWESEOUpdate` (pulls the engine, previews, updates, syncs the skills and verifies in one pass) or `/BWESEOInstall --update`. By hand, first update your engine checkout (`git pull` in the engine folder), then from the
website root:

```
node "$BWESEO_ENGINE_HOME/installer/bweseo-install.mjs" --dry-run --update
node "$BWESEO_ENGINE_HOME/installer/bweseo-install.mjs" --update
node "$BWESEO_ENGINE_HOME/installer/bweseo-install.mjs" --verify
```

Only engine files change. The profile, configuration, inventory, lifecycle, health, Search Console, analytics and reports are
preserved. A file you edited locally is reported as a **CONFLICT: REVIEW REQUIRED** and is not overwritten. A schema migration is
backed up, validated, and rolled back if it fails.

## 8. Maintain the engine itself

The four maintenance skills are shortcuts for the steps below. Each step is shown with its manual equivalent.

### Start of a session (`BWESEOBegin routine`)

```
cd SEOEngine
git pull
cat PROJECT_STATUS.md        # current state, last session, open follow-ups
git status
git log --oneline -5
```

### Make a change

1. Create a branch: `git checkout -b <short-name>`.
2. Edit the files. Keep text files on LF line endings.
3. If you **added a new file**, it must match a classification rule in `RULES` in `installer/bweseo-install.mjs` (most paths already
   do: `src/*.mjs`, `docs/*.md`, `skills/<name>/SKILL.md`, …). A file with no rule makes the manifest build fail on purpose.
4. If you **added a new top-level file or folder**, also add a one-line description to `DIRECTORY_DESCRIPTIONS` in
   `scripts/build-manual.mjs`.
5. If you **added or renamed a skill**, document it in `docs/skills-reference.json`.
6. If the change affects anything a person runs or follows (a command, subcommand or flag, a script, a skill, a file people edit,
   the maintenance workflow or the release steps), **update this guide in the same change**. See "Keeping this guide current" below.
7. Report acceptance evidence with the change: an acceptance table (intended behavior, test performed, expected result, actual result, evidence), the automated regression run, and a demonstration in a disposable project that includes failure and recovery cases. Label automated tests, controlled demonstrations and live-service verification separately, and list what needs customer-site validation, with steps (`CLAUDE.md` rule 9).

### Rebuild and validate (`BWESEOCheckpoint routine`), always in this order

```
node scripts/build-manual.mjs                       # regenerates BWESEO-SKILLS-AND-PROCEDURES.md
node scripts/build-manifest.mjs                     # rebuilds engine-manifest.json (a hash of every file); also: npm run manifest
node scripts/validate-canonical.mjs --run-tests     # must end with: Canonical engine: READY; npm run validate runs it without tests
```

To only VERIFY that the generated files are current, without changing anything, run `npm run check:generated` (it runs
`node scripts/build-manual.mjs --check`, `npm run guide -- --check` and `node scripts/build-manifest.mjs --check`; each exits with an error if its file is stale).
Every pull request runs these checks, `npm ci`, the full test suite and `node scripts/validate-canonical.mjs` automatically
(`.github/workflows/pr-validation.yml`); a stale generated file fails the check instead of being regenerated, so run the three commands above
and commit the result.

Run all three after **any** file change, including documentation and `PROJECT_STATUS.md`: the manifest records every file's hash,
so an unrebuilt manifest makes validation fail. If validation says NOT READY, fix what it names before committing.

### Keeping this guide current

This guide is checked automatically. `node scripts/validate-canonical.mjs` (and `npm run guide -- --check` on its own) reports
**NOT READY** when the guide and the engine disagree, in either direction:

- something the guide tells you to run no longer exists: a script, an npm script, a `seo/tools` command, subcommand or flag, an
  installer flag, a skill, or a linked file;
- something you can run is missing from the guide: a script in `scripts/`, an npm script, a command-line tool shipped to
  `seo/tools/`, an installer flag, or a maintenance skill.

The check cannot judge whether an explanation is still accurate, so whenever behavior changes, reread the affected section too.

### Commit and push

```
git status
git add <the files you changed, by name>      # never .env files, keys, or any seo/data/ folder
git commit -m "<why the change was made>"
git push -u origin <branch>
```

Then open a pull request on GitHub and merge it once it is reviewed. Never rewrite history or force-push without the owner's say-so.

### End of a session (`BWESEOEnd routine`)

Update `PROJECT_STATUS.md`: add a dated section at the top of the session log (what changed, the engine version, decisions made),
and keep **Known follow-ups** to items that are still open. Write no customer names and no machine paths. Then rebuild the manifest,
validate, commit and push as above. (`BWESEOAll routine` is the checkpoint followed by this step.)

### Releasing a new version

Only when the owner names a version (or runs `BWESEORelease routine`, which does all of this and then prepares the ClaudeSkills plugin update), change these together. Versions are `yyyy.mm.dd.nn`: the release date plus a two-digit
sequence for that day, starting at `01` and counting up for each further release the same day (for example `2026.10.19.01`, then
`2026.10.19.02`):

- `VERSION`
- `"version"` in `package.json`
- `ENGINE_VERSION` in `src/validate-seo-data.mjs`
- `STATE_VERSION` in `src/seo-state-core.mjs`, `"version"` in `templates/seo-config.template.json` and the top entries of `package-lock.json`

Add a line for the release at the top of `docs/ENGINE.md`. Bump the schema version (`SCHEMA_VERSION` in the same file) only when the
shape of a project's data file changes, and add a migration in `installer/migrations/` when you do. Then rebuild and validate.

## 9. Rules that always apply

1. **Customer-neutral.** No customer or business names, domains, emails, phone numbers, keywords, analytics ids, Search Console data
   or screenshots anywhere in this repository. Test fixtures use fictional names and `.example` / `.test` domains.
2. **No secrets and no machine paths.** No credentials, tokens, keys or `.env` values (configuration holds a *name* only). No drive
   letters or personal folder paths in code, docs, skills or tests.
3. **One direction.** Changes flow from the engine into websites, never back. Work only in this repository unless the owner asks.
4. **Always rebuild and validate** after a change (section 8), and report the real result.
5. **Skills format.** Every `skills/*/SKILL.md` starts with `---`, `name:`, `description:`, `---` and uses LF line endings.
6. **Staging is never submitted to search engines**, and "indexed" is only ever recorded from Google's own Search Console evidence.

## 10. Troubleshooting

| Message or symptom | Fix |
|---|---|
| `the canonical BWESEO engine cannot be located` | Set `BWESEO_ENGINE_HOME` to the folder containing `VERSION` and `engine-manifest.json` (section 2). |
| `DEPRECATED legacy location` in `--verify` | Set `BWESEO_ENGINE_HOME`, or run `node scripts/register-engine.mjs` once. |
| `Cannot find package 'vitest'` | Run `npm ci` in the engine folder. |
| `no classification rule for <file>` | Add a rule for that path to `RULES` in `installer/bweseo-install.mjs`, or remove the file. |
| Validation fails on a manifest hash | You changed a file after building the manifest. Run `node scripts/build-manifest.mjs` again. |
| A pull-request check says a generated file is stale | Run the three commands under "Rebuild and validate" and commit the changed files. |
| A `SKILL.md` test fails after editing on Windows | The file was saved with CRLF endings. Convert it to LF (`sed -i 's/\r$//' <file>` or your editor's line-ending setting). |
| `build-manual.mjs` reports an undocumented skill | Add the skill to `docs/skills-reference.json`. |
| Update reports **CONFLICT: REVIEW REQUIRED** | A website's copy of an engine file was edited. Decide whether to keep the local change; the engine version is the source of truth. |

Website-side problems (page not indexed, sitemap errors, 404 or 522 responses, wrong canonical, staging visible in Google, …) are
covered in the Troubleshooting section of [BWESEO-SKILLS-AND-PROCEDURES.md](../BWESEO-SKILLS-AND-PROCEDURES.md).

## 11. Where to read more

| Document | What it covers |
|---|---|
| [README.md](../README.md) | Overview, architecture, security and versioning. |
| [BWESEO-SKILLS-AND-PROCEDURES.md](../BWESEO-SKILLS-AND-PROCEDURES.md) | Every skill, the full SEO procedures, approval gates, troubleshooting (generated). |
| [docs/ENGINE.md](ENGINE.md) | The methodology, the three layers, and the release history. |
| [docs/CLOUD-SETUP.md](CLOUD-SETUP.md) | Using the engine from a Claude Project or cloud thread. |
| [docs/methodology/](methodology/) | One document per topic (workflow state, Google index monitoring, keyword performance, technical SEO, …). |
| [PROJECT_STATUS.md](../PROJECT_STATUS.md) | Current state of engine development and open follow-ups. |
