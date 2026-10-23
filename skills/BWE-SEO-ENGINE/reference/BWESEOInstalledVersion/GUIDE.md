# BWE-SEO-ENGINE installed

Read-only. Changes nothing.

1. Work from the website's root (the folder that holds `CLAUDE.md` or `package.json`). Read `seo/bweseo-install.json`: `engineVersion` (also `installedAt` and `updatedAt` if present).
2. If the file does not exist, say `SEO engine is not installed in this project` and point to `/BWE-SEO-ENGINE install`. Do not guess.
3. Print: `SEO engine installed here: <version>`.
4. Compare with the bundled version (`/BWE-SEO-ENGINE version` explains where it is read, relative to this skill's base directory: `../../`). If they differ, say `bundled: <version>; run /BWE-SEO-ENGINE update to update`. If the bundled file cannot be read, skip the comparison.
