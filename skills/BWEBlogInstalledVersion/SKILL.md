---
name: BWEBlogInstalledVersion
description: Shows the version of the Blog engine installed in the current website, from the site's own .bwe-engine/VERSION, and says whether it differs from the bundled version. Read-only. Use when the user says "installed blog engine version", "which blog engine does this site have", or invokes /BWEBlogInstalledVersion, in a website project.
---

# BWEBlogInstalledVersion

Read-only. Changes nothing.

1. Work from the website's root (the folder that holds `CLAUDE.md` or `package.json`). Read `.bwe-engine/VERSION`: the single version line (and `.bwe-engine/dist/cli/main.js` must exist for the engine to be built).
2. If the file does not exist, say `Blog engine is not installed in this project` and point to `/BWEBlogInstall`. Do not guess.
3. Print: `Blog engine installed here: <version>`.
4. Compare with the bundled version (`/BWEBlogVersion` explains where it is read, relative to this skill's base directory: `../../`). If they differ, say `bundled: <version>; run /BWEBlogUpdate to update`. If the bundled file cannot be read, skip the comparison.
