---
name: BWEFAQInstalledVersion
description: Shows the version of the FAQ engine installed in the current website, from the site's own faq/engine/INSTALL.json, and says whether it differs from the bundled version. Read-only. Use when the user says "installed faq engine version", "which faq engine does this site have", or invokes /BWEFAQInstalledVersion, in a website project.
---

# BWEFAQInstalledVersion

Read-only. Changes nothing.

1. Work from the website's root (the folder that holds `CLAUDE.md` or `package.json`). Read `faq/engine/INSTALL.json`: `version`.
2. If the file does not exist, say `FAQ engine is not installed in this project` and point to `/BWEFAQInstall`. Do not guess.
3. Print: `FAQ engine installed here: <version>`.
4. Compare with the bundled version (`/BWEFAQVersion` explains where it is read, relative to this skill's base directory: `../../`). If they differ, say `bundled: <version>; run /BWEFAQUpdate to update`. If the bundled file cannot be read, skip the comparison.
