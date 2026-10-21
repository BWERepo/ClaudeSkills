---
name: BWESEOInstalledVersion
description: Shows the version of the SEO engine installed in the current website, from the site's own seo/bweseo-install.json, and says whether it differs from the bundled version. Read-only. Use when the user says "installed seo engine version", "which seo engine does this site have", or invokes /BWESEOInstalledVersion, in a website project.
---

# BWESEOInstalledVersion

Read-only. Changes nothing.

1. Work from the website's root (the folder that holds `CLAUDE.md` or `package.json`). Read `seo/bweseo-install.json`: `engineVersion` (also `installedAt` and `updatedAt` if present).
2. If the file does not exist, say `SEO engine is not installed in this project` and point to `/BWESEOInstall`. Do not guess.
3. Print: `SEO engine installed here: <version>`.
4. Compare with the bundled version (`/BWESEOVersion` explains where it is read, relative to this skill's base directory: `../../`). If they differ, say `bundled: <version>; run /BWESEOUpdate to update`. If the bundled file cannot be read, skip the comparison.
