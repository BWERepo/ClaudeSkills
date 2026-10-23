---
name: BWE-BLOG-ENGINE
description: Blog Engine control panel. Actions - version, installed, install, update. Use when the user says "Blog engine version", "which sites have the Blog engine", "install or update the latest Blog engine in the site name", or invokes /BWE-BLOG-ENGINE.
---

# BWE-BLOG-ENGINE

Same control panel as the other two engines. Ask which action if the user did not say (version, installed, install, update).

| Setting | Value |
|---|---|
| Engine repo | `BWERepo/BlogEngine` (default branch) |
| Latest version | the single version line in the engine repo's `VERSION` file (check the install skill if the file is elsewhere) |
| Installed version (in a site) | `.bwe-engine/VERSION` |
| Detailed guides | see "Detailed guides" below |
| Client sites | `BWERepo/BWE`, `BWERepo/BWE_HDBS`, `BWERepo/BWE_OneClickAnswers` |

## version
Read-only. Read the latest version from the engine repo and print `Blog engine latest: <version>`.

## installed
Read-only. For each client site, read the installed-version file from the site repo's default branch (GitHub file read, or the local folder if it is the current project). Print a table: site, installed version, latest version, status (current / behind / not installed). Never guess a version; a missing file means not installed.

## install
1. Ask which site (or all). Confirm the site repo and branch.
2. Follow the `install` guide (`reference/BWEBlogInstall/GUIDE.md`) in that site; for a site that already has the engine follow the `update` guide.
3. Re-run `installed` for that site and report old version -> new version.

Never write articles, never deploy, never push or commit unless the owner asks.

## Detailed guides
Each action has a full procedure. Read the guide, then follow it exactly:

| Action | Guide |
|---|---|
| version | `reference/BWEBlogVersion/GUIDE.md` |
| installed | `reference/BWEBlogInstalledVersion/GUIDE.md` |
| install | `reference/BWEBlogInstall/GUIDE.md` |
| update | `reference/BWEBlogUpdate/GUIDE.md` |

The `version` and `installed` guides describe the plugin-bundled engine and the engine installed in the current site. The `install` guide also covers sync.
