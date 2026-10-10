---
name: BWEBlogInstall
description: Installs the bundled Blog Engine into the current website (copies it to .bwe-engine/, builds it, creates bwe-blog.config.json, git-ignores engine files). Never writes articles, never deploys. Use when the user says "install the blog engine", "add a blog to this site", "set up the blog engine", or invokes /BWEBlogInstall, in any website project.
---

# BWEBlogInstall

Installs the **engine** only. The site's settings are `/BWEBlogSetup`'s job.

## Locate the engine

`$BLOG_ENGINE` = the Blog Engine bundled in this plugin: `../../engines/blog`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first). No separate checkout is needed. Never write a machine path into the website repository.

## Steps

1. **Confirm the target.** State the website folder and `git remote get-url origin`. It must be the owner's website, not the plugin or an engine repository. Recommend committing uncommitted work first; do not commit for them. Node 20 or newer is required (`node --version`).
2. **If `.bwe-engine/` already exists**, do not reinstall: say so and point to `/BWEBlogUpdate`.
3. **Show the plan and ask for approval:** copy `$BLOG_ENGINE` (without `tests/` and `node_modules/`) to `<website>/.bwe-engine/`, run `npm ci --no-audit --no-fund && npm run build` inside it, add `.bwe-engine/` and `.bwe-blog/` to `.gitignore`.
4. **Run it** after approval, then `node .bwe-engine/dist/cli/main.js init` from the website root. `init` never overwrites an existing `bwe-blog.config.json` or touches an existing page.
5. **Verify:** `node .bwe-engine/dist/cli/main.js status` runs. Report the engine version (`.bwe-engine/VERSION`).
6. **Next step:** `/BWEBlogSetup`.

Never commit, push or deploy. Never write credentials into the repository.
