# BWE-BLOG-ENGINE installed

Read-only. Changes nothing.

1. Work from the website's root (the folder that holds `CLAUDE.md` or `package.json`). Read `.bwe-engine/VERSION`: the single version line (and `.bwe-engine/dist/cli/main.js` must exist for the engine to be built).
2. If the file does not exist, say `Blog engine is not installed in this project` and point to `/BWE-BLOG-ENGINE install`. Do not guess.
3. Print: `Blog engine installed here: <version>`.
4. Compare with the bundled version (`/BWE-BLOG-ENGINE version` explains where it is read, relative to this skill's base directory: `../../`). If they differ, say `bundled: <version>; run /BWE-BLOG-ENGINE update to update`. If the bundled file cannot be read, skip the comparison.
