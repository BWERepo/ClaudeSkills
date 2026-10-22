---
name: BWE_FAQEngine
description: FAQ Engine control panel. Actions - version (latest engine version), installed (version installed in each client website), install (install or update the latest engine in a chosen client website). Use when the user says "FAQ engine version", "which sites have the FAQ engine", "install the latest FAQ engine in the site name", or invokes /BWE_FAQEngine.
---

# BWE_FAQEngine

Same three actions as `BWE_SEOEngine` and `BWE_BlogEngine`. Ask which action if the user did not say (version, installed, install).

| Setting | Value |
|---|---|
| Engine repo | `BWERepo/FAQEngine` (default branch) |
| Latest version | `version` in `package.json` in the engine repo |
| Installed version (in a site) | `version` in `faq/engine/INSTALL.json` |
| Install skill | `/BWEFAQInstall` (it uses `--update` if the engine is already present) |
| Client sites | `BWERepo/BWE`, `BWERepo/BWE_HDBS`, `BWERepo/BWE_OneClickAnswers` |

## version
Read-only. Read the latest version from the engine repo (GitHub file read; no clone needed) and print `FAQ engine latest: <version>`.

## installed
Read-only. For each client site, read the installed-version file from the site repo's default branch (GitHub file read, or the local folder if it is the current project). Print a table: site, installed version, latest version, status (current / behind / not installed). Never guess a version; a missing file means not installed.

## install
1. Ask which site (or all). Confirm the site repo and branch.
2. Run `/BWEFAQInstall` in that site (it fetches the latest engine on every run; `--dry-run` first for a first install).
3. Re-run `installed` for that site and report old version -> new version.

Never deploy, never push or commit unless the owner asks, never write business facts.
