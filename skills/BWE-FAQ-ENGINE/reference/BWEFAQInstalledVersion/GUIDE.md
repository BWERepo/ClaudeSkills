# BWE-FAQ-ENGINE installed

Read-only. Changes nothing.

1. Work from the website's root (the folder that holds `CLAUDE.md` or `package.json`). Read `faq/engine/INSTALL.json`: `version`.
2. If the file does not exist, say `FAQ engine is not installed in this project` and point to `/BWE-FAQ-ENGINE install`. Do not guess.
3. Print: `FAQ engine installed here: <version>`.
4. Compare with the bundled version (`/BWE-FAQ-ENGINE version` explains where it is read, relative to this skill's base directory: `../../`). If they differ, say `bundled: <version>; run /BWE-FAQ-REFRESH to update`. If the bundled file cannot be read, skip the comparison.
