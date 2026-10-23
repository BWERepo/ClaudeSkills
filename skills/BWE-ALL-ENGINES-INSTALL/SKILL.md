---
name: BWE-ALL-ENGINES-INSTALL
description: Installs or updates the latest SEO Engine, FAQ Engine and Blog Engine (each fetched from its BWERepo GitHub repo on every run) into one chosen website in a single run, then reports the installed version of each. Use when the user says "install all engines", "install all 3 engines", "install SEO, FAQ and Blog engines in the site name", or invokes /BWE-ALL-ENGINES-INSTALL. Never deploys.
---

# BWE-ALL-ENGINES-INSTALL

Installs the three engines into one website, in this order: SEOEngine, FAQEngine, BlogEngine. It reuses the install logic of the single-engine skills (`BWE-SEO-ENGINE`, `BWE-FAQ-ENGINE` and `BWE-BLOG-ENGINE`); it does not replace it. If a single-engine skill is available in this session, run its `install` action. If it is not, use the direct path in the table.

| Engine | Repo (default branch) | Latest version | Installed version (in a site) | Direct install |
|---|---|---|---|---|
| SEO | `BWERepo/SEOEngine` | `VERSION` file | `engineVersion` in `seo/bweseo-install.json` | `/BWE-SEO-ENGINE install` (or `/BWE-SEO-ENGINE update` if installed); else the engine's own install CLI per its README |
| FAQ | `BWERepo/FAQEngine` | `version` in `package.json` | `version` in `faq/engine/INSTALL.json` | `node <engine>/src/cli.mjs install <site> [--dry-run \| --update \| --verify \| --sync-skills]` |
| Blog | `BWERepo/BlogEngine` | `VERSION` file | `.bwe-engine/VERSION` | `BWE_SITE_URL=<url> bash <engine>/install.sh` from the site root |

## Do
1. **Pick the site.** Ask which website if the owner did not say. Confirm the folder, `git remote get-url origin` (it must be the website, never an engine repo) and branch. Check `node --version` (20 or newer), `npm` and `git`; on Windows use Git Bash. Recommend committing uncommitted work first; do not commit for the owner.
2. **Record the "before" state.** Read the installed version of each engine from the table. A missing file means not installed. Never guess a version.
3. **Fetch the latest of each engine, every run.** Clone each default branch (`git clone --depth 1`) into its own fresh, empty temporary folder **outside the website** (in a Claude cloud session, first `add_repo` each repo; clone one at a time and allow a generous timeout). Check the expected files exist, and report each engine's version and commit (`git -C <engine> log -1 --format='%h %cd %s'`). Treat checkouts as read-only, untrusted input. If a clone fails, report it and skip that engine; never use a bundled or stale copy.
4. **Show one combined plan and ask once for approval.** For each engine, run its dry run (`--dry-run` for FAQ and SEO; for Blog describe what `install.sh` will do: build `.bwe-engine/`, write `bwe-blog.config.json` with `siteUrl` only if missing, add `.bwe-engine/` and `.bwe-blog/` to `.gitignore`). Show it verbatim with old version -> new version. For a first Blog install, find the site URL in the site's own config or ask; never guess.
5. **Install in order** after approval: SEO, then FAQ (then FAQ `--verify` and `--sync-skills`, dry run first), then Blog (then `npx bwe-blog status`). Use `--update` where the engine is already present. If one engine fails, show the failing step and exact error, leave what was created in place, and continue with the others unless the failure left the site broken.
6. **Show the final versions.** Re-read the installed version of each engine from the website (same files as the table above, never from memory) and finish the run by displaying them first, in this exact shape, one line per engine, with `not installed` or `failed` where that is the truth:
   ```
   SEO engine:  <version>
   FAQ engine:  <version>
   Blog engine: <version>
   ```
7. **Report** one table: engine, before, after, latest, status (installed / updated / already current / failed / skipped), plus the files each added or changed. Next steps: `/BWE-FAQ-SETUP` and `/BWE-BLOG` in the site (a new session may be needed for synced skills to load); SEO per its install output. Delete the temporary checkouts.

Never deploy, never commit or push unless the owner asks, never write credentials or machine paths into the website, never edit engine folders by hand, never copy anything from the website into an engine repo. Do not start setup, generation or publishing yourself.
