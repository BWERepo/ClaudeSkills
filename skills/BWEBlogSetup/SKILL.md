---
name: BWEBlogSetup
description: Sets up the Blog Engine's configuration for the current website (siteUrl, approval mode, article limits, AI provider choice by name only). Never stores keys. Use when the user says "set up the blog", "configure the blog engine", or invokes /BWEBlogSetup, in any website project.
---

> `bwe-blog <command>` means `node .bwe-engine/dist/cli/main.js <command>`, run from the website's root. If that file is missing, the engine is not installed: run `/BWEBlogInstall` first.


# BWEBlogSetup

1. Open `bwe-blog.config.json` (created by `bwe-blog init`). If missing, run `/BWEBlogInstall` first.
2. Ask the owner for the site's real public address and set `siteUrl`. Never guess it.
3. Run `bwe-blog guide "approval modes"` and `bwe-blog guide "choosing who writes the drafts"`; explain the options in plain English and set only what the owner chooses. The default keeps a human approval step before anything is published.
4. An AI provider key is referenced by environment variable **name** only; never write a key into the config or the repository.
5. Run `bwe-blog status` and report the next step (normally `/BWEBlog`, then `bwe-blog analyze`).
