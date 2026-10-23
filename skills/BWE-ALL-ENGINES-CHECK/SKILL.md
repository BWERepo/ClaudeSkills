---
name: BWE-ALL-ENGINES-CHECK
description: Takes a website project name and reports whether the SEO Engine, FAQ Engine or Blog Engine installed in it needs updating, by comparing the installed version with the latest in each BWERepo engine repo. Read-only. Use when the user says "check engine versions", "does the site name need engine updates", "are the engines up to date", or invokes /BWE-ALL-ENGINES-CHECK.
---

# BWE-ALL-ENGINES-CHECK

Read-only check of the three engines in one website. It reuses the version logic of `BWE-SEO-ENGINE`, `BWE-FAQ-ENGINE` and `BWE-BLOG-ENGINE` (`version` and `installed` actions); it does not replace it. To act on the result, use `BWE-ALL-ENGINES-INSTALL` or a single-engine `update`.

Input: the website project name. Ask if the owner did not give one.

| Engine | Repo (default branch) | Latest version | Installed version (in the site) |
|---|---|---|---|
| SEO | `BWERepo/SEOEngine` | `VERSION` file | `engineVersion` in `seo/bweseo-install.json` |
| FAQ | `BWERepo/FAQEngine` | `version` in `package.json` | `version` in `faq/engine/INSTALL.json` |
| Blog | `BWERepo/BlogEngine` | `VERSION` file | `.bwe-engine/VERSION` |

## Do
1. **Find the site.** Match the name to a repo under `BWERepo` (or the current folder if it is that site). If several match or none, list candidates and ask. Never guess.
2. **Read the latest version** of each engine from its repo's default branch (GitHub file read; no clone needed). If a read fails, mark that engine `unknown` and say why.
3. **Read the installed version** of each engine from the site's default branch using the paths above. A missing file means `not installed`. Never guess a version.
4. **Compare** as dotted numeric versions (`yyyy.mm.dd.nn` or semver, compared part by part). Status per engine:
   - `UPDATE NEEDED`: installed is lower than latest.
   - `UP TO DATE`: installed equals latest.
   - `NOT INSTALLED`: no installed-version file (an install is needed).
   - `AHEAD`: installed is higher than latest (report it, do not call it an update).
   - `UNKNOWN`: a version could not be read.
5. **Report** a table, then one verdict line per engine, then an overall line:
   ```
   | Engine | Installed | Latest | Verdict |
   |---|---|---|---|
   | SEO  | <v> | <v> | UPDATE NEEDED / UP TO DATE / NOT INSTALLED / AHEAD / UNKNOWN |
   | FAQ  | ... |
   | Blog | ... |
   Overall: <n> of 3 engines need an update or install. Run /BWE-ALL-ENGINES-INSTALL to bring them current.
   ```
   If all three are up to date, the overall line is `All 3 engines are up to date.`

Strictly read-only: do not clone into the site, install, update, commit, push or deploy. Do not write anything to the site or to an engine repo.
