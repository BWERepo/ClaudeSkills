---
name: BWE-SEO-SETUP
description: Configures BWE-SEO for the current customer's website project AFTER the engine is installed (/BWE-SEO-ENGINE install) — creates the customer-specific seo/seo-config.json, business profile and content inventory (and docs/seo/), picks the stack adapter, and builds a verified business profile from the customer questionnaire, the live site and the owner's answers, flagging missing facts instead of inventing them. Determines the project's environments (verified production URL, staging URL or STAGING ENVIRONMENT - NOT CONFIGURED, preview, deployment architecture, how staging is kept out of search results), the sitemap URL, the Search Console property and who owns it, whether the optional Search Console API integration will be used and where its credential lives (a NAME, never the credential), and the analytics status. Use when the user says "set up SEO", "configure SEO for this client", "SEO onboarding", or invokes /BWE-SEO-SETUP, in any website project.
---

> `$BWESEO_ENGINE` = the BWE-SEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWE-SEO-SETUP

Engine: `$BWESEO_ENGINE/`. Read `docs/ENGINE.md`,
`docs/methodology/discovery-onboarding.md` and `docs/methodology/questionnaire-mapping.md`.

Setup is the **customer-specific** phase. The **engine** is installed separately by `/BWE-SEO-ENGINE install`.

## Step 0 — the engine must be installed

Check `seo/bweseo-install.json` and `seo/tools/seo-state-core.mjs`. If either is missing → stop and say:
"BWE-SEO is not installed in this project. Run `/BWE-SEO-ENGINE install` first (start with `--dry-run`)." Do **not**
copy engine files by hand — that is the installer's job, and it is what keeps customer data and engine
apart. (A project that already has SEO tooling but no receipt is a *legacy* install: recommend
`/BWE-SEO-ENGINE install --dry-run` to adopt it safely.)

## Steps

1. **Confirm the target.** State the repo root, `git remote get-url origin`, and the business you
   believe this is. If `seo/seo-config.json` already exists, run the project guard (see
   `/BWE-SEO` Step 0) and switch to *update* mode — never overwrite an existing profile,
   inventory or docs.
2. **Discover the stack** (read-only): package.json / framework files, routes, where metadata,
   sitemap, robots and JSON-LD live, content sources, build/test/deploy commands, existing docs
   folder conventions. The installer recorded an adapter in the receipt if the engine ships one for this
   framework; if not, write a new adapter from `adapters/_template.md` only with the owner's
   approval (keep it business-agnostic and generic).
3. **Create the customer-specific footprint** (reuse existing folders if the project already has equivalents):
   - `seo/seo-config.json` from `templates/seo-config.template.json` — fill `projectId`,
     `website`, `repo`, `adapter`, `stack`, `workflows`, `conversion`, `analytics`, `schemaVersion`
     (from the installed engine), `engine.version` (from the receipt).
   - `seo/business-profile.json`, `seo/content-inventory.json` from the templates.
   - In `seo-config.json`: the `environments` block (`docs/methodology/environments.md` →
     Setup) — production `url` + `hosts`; staging `status` / `url` / `hosts` (custom and platform
     hostnames) / `deploy` / `indexProtection`, or `{ "status": "not-configured" }` when the project
     has no staging; preview only if it really exists; how to run it locally. Only verified values
     (deploy config, deploy scripts, the site's own host rules, read-only requests to each host) —
     never a guessed URL. Measure staging's protection (`curl -sI` for `X-Robots-Tag`, the robots
     meta, robots.txt); weak or missing protection becomes an `issues[]` entry with
     `area: "environment"` for the owner to decide. Also `environments.health` (where the live check runs:
     `browser` by default — a host must not fetch its own zone).
   - In `seo-config.json`: the `publication` block (production sitemap URL, robots URL, where the
     navigation lives, any IndexNow/Bing mechanism the site **already** has) and
     `analytics.searchConsole`. **Ask and record, never assume:** the sitemap URL; the Search Console
     property (or `configured: "unknown"`) and who OWNS it — it should belong to the **customer's own Google
     account**, with the agency granted access; never assume the agency owns it and never store a
     verification token; whether the optional **Search Console API integration** will be used
     (`enabled`) and, if so, **where the credential lives** as a NAME only (`credentialsSource:
     "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON"`) — never the credential; the analytics status (tag manager /
     analytics ids and whether conversion data is available). `configured` and `sitemap.submitted` stay
     `unknown` until the owner confirms. All values are this project's own — never copied from another project.
   - `.gitignore`: the installer already added `seo/data/`, `seo/sources/` and `seo/.bweseo-backup/`.
   - `docs/seo/` — generic shells exist from the install; add the project's docs per `templates/docs/README.md`.
4. **Build the profile** from, in order: owner statements, questionnaire export in
   `seo/sources/`, the live site / admin data (read-only). Every Fact gets `status`, `source`,
   `verifiedOn`. Unknowns → `needs-input` + an `openQuestions` entry naming what it blocks.
   Use the industry guide `docs/industries/<industry>.md` to know which facts matter.
   Mark a question `blocking: true` only if nothing can proceed without it; otherwise list what it
   holds up in `blocks` (inventory ids or paths), so /BWE-SEO asks it only when that item is next.
5. **Inventory existing pages**: every public URL → an inventory entry (`published`, with title,
   intent, parent, CTA, `lastReviewed` = today).
6. **Validate**: `node seo/tools/validate-seo-data.mjs` (+ the project's test command if a test
   was added). Also run the isolation scan:
   `node seo/tools/validate-seo-data.mjs --engine $BWESEO_ENGINE --profile seo/business-profile.json`.
7. **Register this project's identity** (so no future engine build or install can ever carry this customer's
   data to another): `node $BWESEO_ENGINE/installer/bweseo-install.mjs --register-project`. It stores fingerprints
   (domains, name, analytics ids, contact details) on this machine only and prints no values.
8. **Report**: files created, adapter chosen, the environments found:

   ```
   Production URL ........ <verified>
   Staging URL ........... <verified>  |  STAGING ENVIRONMENT: NOT CONFIGURED
   Preview behavior ...... <verified pattern>  |  not configured
   Deployment architecture <detected>
   Staging protection .... strong / weak / none
   Search Console ........ <property / unknown> — owner: <customer / agency / unknown>
   Search Console API .... enabled (credential: <NAME>) | not configured (steps stay manual)
   Analytics ............. <ids / not configured>
   ```

   profile completeness (verified / needs-input counts), the open questions for the owner, and the
   next step — or simply "run /BWE-SEO", which will say so.

Do not commit, push or deploy. Do not create public pages. Do not contact Google or change Search Console.
