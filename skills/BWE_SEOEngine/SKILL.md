---
name: BWE_SEOEngine
description: SEO Engine control panel. Actions - version (latest engine version), installed (version installed in each client website), install (install or update the latest engine in a chosen client website). Use when the user says "SEO engine version", "which sites have the SEO engine", "install the latest SEO engine in the site name", or invokes /BWE_SEOEngine.
---

# BWE_SEOEngine

Same three actions as `BWE_FAQEngine` and `BWE_BlogEngine`. Ask which action if the user did not say (version, installed, install).

| Setting | Value |
|---|---|
| Engine repo | `BWERepo/SEOEngine` (default branch) |
| Latest version | the `VERSION` file in the engine repo |
| Installed version (in a site) | `engineVersion` in `seo/bweseo-install.json` |
| Install skill | `/BWESEOInstall` (plain install on an installed site hands off to `/BWESEOUpdate`) |
| Client sites | `BWERepo/BWE`, `BWERepo/BWE_HDBS`, `BWERepo/BWE_OneClickAnswers` |

## version
Read-only. Read the latest version from the engine repo and print `SEO engine latest: <version>`.

## installed
Read-only. For each client site, read the installed-version file from the site repo's default branch (GitHub file read, or the local folder if it is the current project). Print a table: site, installed version, latest version, status (current / behind / not installed). Never guess a version; a missing file means not installed.

## install
1. Ask which site (or all). Confirm the site repo and branch.
2. Run `/BWESEOInstall` in that site (`--dry-run` first for a first install; `/BWESEOUpdate` if already installed).
3. Re-run `installed` for that site and report old version -> new version.

Never deploy, never push or commit unless the owner asks, never copy customer data into the engine.
