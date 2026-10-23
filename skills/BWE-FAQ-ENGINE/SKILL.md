---
name: BWE-FAQ-ENGINE
description: FAQ Engine control panel. Actions - version, installed, install. Use when the user says "FAQ engine version", "which sites have the FAQ engine", "install or update the latest FAQ engine in the site name", or invokes /BWE-FAQ-ENGINE.
---

# BWE-FAQ-ENGINE

Same control panel as the other two engines. Ask which action if the user did not say (version, installed, install).

| Setting | Value |
|---|---|
| Engine repo | `BWERepo/FAQEngine` (default branch) |
| Latest version | `version` in `package.json` in the engine repo |
| Installed version (in a site) | `version` in `faq/engine/INSTALL.json` |
| Detailed guides | see "Detailed guides" below |
| Client sites | `BWERepo/BWE`, `BWERepo/BWE_HDBS`, `BWERepo/BWE_OneClickAnswers` |

## version
Read-only. Read the latest version from the engine repo (GitHub file read; no clone needed) and print `FAQ engine latest: <version>`.

## installed
Read-only. For each client site, read the installed-version file from the site repo's default branch (GitHub file read, or the local folder if it is the current project). Print a table: site, installed version, latest version, status (current / behind / not installed). Never guess a version; a missing file means not installed.

## install
1. Ask which site (or all). Confirm the site repo and branch.
2. Follow the `install` guide (`reference/BWEFAQInstall/GUIDE.md`) in that site; for a site that already has the engine follow the `update` guide.
3. Re-run `installed` for that site and report old version -> new version.

Never deploy, never push or commit unless the owner asks, never write business facts.

## Detailed guides
Each action has a full procedure. Read the guide, then follow it exactly:

| Action | Guide |
|---|---|
| version | `reference/BWEFAQVersion/GUIDE.md` |
| installed | `reference/BWEFAQInstalledVersion/GUIDE.md` |
| install | `reference/BWEFAQInstall/GUIDE.md` |
