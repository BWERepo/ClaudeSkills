---
name: BWE-SEO-ENGINE
description: SEO Engine control panel. Actions - version, installed, install, update, dry-run, verify. Use when the user says "SEO engine version", "which sites have the SEO engine", "install or update the latest SEO engine in the site name", or invokes /BWE-SEO-ENGINE.
---

# BWE-SEO-ENGINE

Same control panel as the other two engines. Ask which action if the user did not say (version, installed, install, update, dry-run, verify).

| Setting | Value |
|---|---|
| Engine repo | `BWERepo/SEOEngine` (default branch) |
| Latest version | the `VERSION` file in the engine repo |
| Installed version (in a site) | `engineVersion` in `seo/bweseo-install.json` |
| Detailed guides | see "Detailed guides" below |
| Client sites | `BWERepo/BWE`, `BWERepo/BWE_HDBS`, `BWERepo/BWE_OneClickAnswers` |

## version
Read-only. Read the latest version from the engine repo and print `SEO engine latest: <version>`.

## installed
Read-only. For each client site, read the installed-version file from the site repo's default branch (GitHub file read, or the local folder if it is the current project). Print a table: site, installed version, latest version, status (current / behind / not installed). Never guess a version; a missing file means not installed.

## install
1. Ask which site (or all). Confirm the site repo and branch.
2. Follow the `install` guide (`reference/BWESEOInstall/GUIDE.md`) in that site; for a site that already has the engine follow the `update` guide.
3. Re-run `installed` for that site and report old version -> new version.

Never deploy, never push or commit unless the owner asks, never copy customer data into the engine.

## Detailed guides
Each action has a full procedure. Read the guide, then follow it exactly:

| Action | Guide |
|---|---|
| version | `reference/BWESEOVersion/GUIDE.md` |
| installed | `reference/BWESEOInstalledVersion/GUIDE.md` |
| install | `reference/BWESEOInstall/GUIDE.md` |
| update | `reference/BWESEOInstallUpdate/GUIDE.md` |
| update (full, incl. skills) | `reference/BWESEOUpdate/GUIDE.md` |
| dry-run | `reference/BWESEOInstallDryRun/GUIDE.md` |
| verify | `reference/BWESEOInstallVerify/GUIDE.md` |

The `version` and `installed` guides describe the plugin-bundled engine and the engine installed in the current site. The `install` guide also covers sync.
