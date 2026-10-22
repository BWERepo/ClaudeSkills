---
name: BWE_BlogEngine
description: Blog Engine control panel. Actions - version (latest engine version), installed (version installed in each client website), install (install or update the latest engine in a chosen client website). Use when the user says "blog engine version", "which sites have the blog engine", "install the latest blog engine in <site>", or invokes /BWE_BlogEngine.
---

# BWE_BlogEngine

Same three actions as `BWE_FAQEngine` and `BWE_SEOEngine`. Ask which action if the user did not say (version, installed, install).

| Setting | Value |
|---|---|
| Engine repo | `BWERepo/BlogEngine` (default branch) |
| Latest version | the single version line in the engine repo's `VERSION` file (check the install skill if the file is elsewhere) |
| Installed version (in a site) | `.bwe-engine/VERSION` |
| Install skill | `/BWEBlogInstall` for a first install, `/BWEBlogUpdate` if already installed |
| Client sites | `BWERepo/BWE`, `BWERepo/BWE_HDBS`, `BWERepo/BWE_OneClickAnswers` |

## version
Read-only. Read the latest version from the engine repo and print `Blog engine latest: <version>`.

## installed
Read-only. For each client site, read the installed-version file from the site repo's default branch (GitHub file read, or the local folder if it is the current project). Print a table: site, installed version, latest version, status (current / behind / not installed). Never guess a version; a missing file means not installed.

## install
1. Ask which site (or all). Confirm the site repo and branch.
2. Run `/BWEBlogInstall` or `/BWEBlogUpdate` in that site, as in the table.
3. Re-run `installed` for that site and report old version -> new version.

Never write articles, never deploy, never push or commit unless the owner asks.
