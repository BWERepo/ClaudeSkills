---
name: BWEBlogUpdate
description: Updates the Blog Engine in the current website to the version bundled in this plugin, keeping the site's config, data and articles. Never commits or deploys. Use when the user says "update the blog engine", "upgrade the blog engine", or invokes /BWEBlogUpdate, in any website project.
---

# BWEBlogUpdate

`$BLOG_ENGINE` = `../../engines/blog`, relative to this skill's base directory (resolve it to an absolute path first).

1. **Guard.** The current folder must be a website with `.bwe-engine/`. If not, recommend `/BWEBlogInstall`.
2. **Compare versions.** Report `.bwe-engine/VERSION` against `$BLOG_ENGINE/VERSION`. If they match, say it is up to date and stop. A newer engine arrives only by updating the plugin (`claude plugin update bwe-skills@bwe-skills`).
3. **Show the plan and ask for approval:** replace the engine files in `.bwe-engine/` with the bundled copy (without `tests/` and `node_modules/`), then `npm ci --no-audit --no-fund && npm run build` inside it. `bwe-blog.config.json`, `.bwe-blog/` and every published article stay untouched.
4. **Apply**, then run `node .bwe-engine/dist/cli/main.js status` and `rebuild-index`, and report the version before and after.

Never commit, push or deploy.
