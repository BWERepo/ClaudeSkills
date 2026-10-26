---
name: BWE-SEO-WATCH
description: Runs and verifies the Google search monitoring workflow (seo-watch) in the current website project - sitemap kept current from page events, a daily check of new pages plus a rotating sample, flags for pages Google has not indexed, crawl failures and unexpected canonicals, and a weekly report with the three most useful fixes. Its `setup` mode walks the owner through the exact customer-site validation steps one at a time and records what passed. Use when the user says "search watch", "search monitoring", "keep the sitemap updated", "daily check", "weekly report", "turn search watch on or off", "verify the search monitoring on the site", or invokes /BWE-SEO-WATCH, in any website project.
---

> `$BWESEO_ENGINE` = the BWE-SEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWE-SEO-WATCH

Tool: `node seo/tools/seo-watch.mjs` (installed with the engine). Read `docs/methodology/search-watch.md` first. The workflow is ON by default after
an install; `disable` / `enable` switch it. Nothing here deploys, requests indexing or submits a URL. Only `daily` (and `weekly` without `--rows`) make network
requests: read-only GETs of the site's own production pages and the official Search Console API with the credential NAMED in `seo-config.json`.

## Engine requirement
This skill needs engine **2026.10.26.02 or newer** (the `seo-watch.mjs` tool). Check `seo/tools/seo-watch.mjs` exists in the project. If it does not, stop and say: "This project's BWE-SEO engine is too old for search watch. Run /BWE-SEO-ENGINE install --dry-run --update, then /BWE-SEO-ENGINE install --update." If the update still leaves it missing, the plugin's bundled engine is older than 2026.10.26.02; report that plainly and do not improvise the tool.

## Project guard
Run from the website project root (`seo/seo-config.json` must exist, else stop and suggest `/BWE-SEO-SETUP`). Start with `node seo/tools/seo-watch.mjs status`.

## Modes
- `/BWE-SEO-WATCH` or `status` - run `status` and `findings`; report what they print, then the single next step.
- `enable` / `disable` - ask the owner for their name, then `node seo/tools/seo-watch.mjs enable --by "<name>"` (or `disable`). Say plainly that data is kept and nothing is deleted.
- `daily` - run `node seo/tools/seo-watch.mjs daily`, then `node seo/tools/seo-queue.mjs build` so findings reach the queue. Never describe a page as not indexed unless the output
  says the evidence is Search Console. If it says indexing was not checked, say that.
- `weekly` - run `node seo/tools/seo-watch.mjs weekly` (add `--rows rows.json` when the owner supplies saved page rows). Show the report. Traffic changes are a comparison of
  two periods, never a proven cause; low-volume pages are not compared.
- `setup` - the customer-site validation walkthrough below.

## `setup`: customer-site validation, one step at a time
Do one step, show the real output, ask the owner to confirm before the next. Stop at the first failing step and say what failed and what is needed; never skip ahead. Record
nothing as passed that was not shown.
1. **Installed and on.** `node seo/tools/seo-watch.mjs status` (expect ON) and `node seo/tools/seo-doctor.mjs`. Pass: status prints ON; doctor lists "search watch".
2. **Seed.** `node seo/tools/seo-watch.mjs seed --sitemap <the site's current sitemap file>` then `node seo/tools/seo-watch.mjs sync --dry-run`. Pass: the dry run shows no unexpected
   URLs dropped (a drop of more than 20% is refused by design; investigate rather than using `--allow-shrink`).
3. **Publish hook (site work).** The site's publish step must run `node seo/tools/seo-watch.mjs notify <url> --event published|changed|removed` for each page it publishes, changes or
   removes (with `--lastmod` and `--canonical` when it knows them). Help the owner add it using the adapter in `$BWESEO_ENGINE/adapters`. Pass: publish or change one test page, then `status`
   shows one inbox file; `sync` moves it to processed and the sitemap contains the page with the right `lastmod`. A removed page leaves the sitemap.
4. **Sitemap is served.** The sitemap URL in `seo-config.json` returns 200 with the new content (use `node seo/tools/seo-site-checks.mjs`). Registering it with Search Console is the existing
   `node seo/tools/seo-google.mjs sitemap` (dry run first; `--submit` only with the owner's explicit say-so).
5. **Search Console access.** `analytics.searchConsole.credentialsSource` names the credential (a NAME such as `env:BWESEO_GSC_SERVICE_ACCOUNT_JSON`; never ask for or print the key) and the
   service account has access to the property. `node seo/tools/seo-google.mjs api-status` must report available.
6. **First daily run.** `node seo/tools/seo-watch.mjs daily`. Pass: a page the owner knows is indexed shows no finding; a page they know is not indexed (if any) is flagged with Search Console
   as the evidence; `status` shows inspections used today under the cap.
7. **Rotation continues.** On the next day (or with the owner's scheduler) run `daily` again: `status` shows the rotation cursor moved and no page was repeated before the others.
8. **Schedule (site host work).** `sync` after publishes, `daily` once a day, `weekly` once a week, run from the project root by the host's scheduler. This skill does not install a scheduler.
9. **Weekly report.** `node seo/tools/seo-watch.mjs weekly`; check the clicks and impressions against the Search Console screen for the same dates. Pass: they agree, three fixes (or an
   honest "fewer than three") with reasons.
End with a table: step, result (passed / failed / not done), the evidence shown. Customer-site steps that were not done are listed as not done, never as passed.

## Rules
Report only what the commands print. "Not indexed" only from Search Console URL Inspection evidence. An API outage is "indexing not checked", never "not indexed". Staging is never checked or
submitted. Credentials are named, never stored or printed. Do not use `--allow-shrink` without the owner's explicit approval.
