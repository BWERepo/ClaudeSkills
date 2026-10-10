---
name: BWEFAQInstall
description: Installs the reusable FAQ Engine into the current website project (and updates, verifies or syncs its Claude skills later). Copies only the engine (code, client files, docs) into faq/engine/ with a hash receipt, scaffolds the site-owned files (faq/faq.config.json, faq/faq-registry.json, faq/candidates.json) once, and ensures .faq/ is git-ignored. Never writes business facts, FAQs or credentials, never deploys. Modes - install (default), --dry-run, --update, --verify, --sync-skills. Use when the user says "install the FAQ engine", "add FAQs to this site", "set up the FAQ engine", "update the FAQ engine", "verify the FAQ install", or invokes /BWEFAQInstall, in any website project.
---

# BWEFAQInstall

```
NEW WEBSITE → /BWEFAQInstall → engine in faq/engine/ → /BWEFAQSetup → site configuration → /BWEFAQ → guided FAQ creation
```

This skill installs the **engine** only. The site's own settings are `/BWEFAQSetup`'s job.

## Locate the engine

`$BWEFAQ_ENGINE` = the FAQ Engine bundled in this plugin: `../../engines/faq`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first). No separate checkout is needed, and never write a machine path into the website repository.

## Run it

Targeting the website folder:

```
node "$BWEFAQ_ENGINE/src/cli.mjs" install <website-folder> [--dry-run | --update | --verify | --sync-skills [--dir <folder>]]
```

## Steps

1. **Confirm the target.** State the website folder and `git remote get-url origin`. It must be the owner's website, not the engine repository. If there is uncommitted work, recommend
   committing or backing it up first; do not commit for them.
2. **Dry run first** for a first install: run `--dry-run`, show the plan verbatim, ask for approval.
3. **Install.** Run without flags. It creates `faq/engine/` (with `INSTALL.json`, a hash of every file), scaffolds the three site files if missing, and adds `.faq/` to `.gitignore`.
4. **If it refuses** (`faq/engine` already exists), explain: use `--update` to replace the engine copy. The site files are always kept.
5. **Verify.** Run `--verify`; show the result. Modified or missing engine files are reported. Never edit `faq/engine/` by hand.
6. **Skills.** `--sync-skills --dry-run`, show it, then `--sync-skills` with approval. This copies the BWEFAQ skills into `<website>/.claude/skills` so Claude can guide the owner in that
   project. A skill file the owner edited by hand is a CONFLICT and is left alone.
7. **Hand off.** Say exactly:

   > FAQ Engine installed successfully.
   >
   > No site configuration exists yet.
   >
   > Next recommended action: `/BWEFAQSetup`

   Do not start setup yourself and do not assume the site's name, URL, categories or content.

## Never

Deploy, push, commit (unless asked), change hosting or search settings, publish content, overwrite a site file, or copy anything from a website into the engine repository.
