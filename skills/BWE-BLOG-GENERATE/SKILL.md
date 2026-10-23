---
name: BWE-BLOG-GENERATE
description: Runs the Blog Engine's analyze, recommend, select and generate steps for the current website, always with the owner choosing which articles to write. Never approves or publishes. Use when the user says "generate blog articles", "recommend blog topics", "write the selected articles", or invokes /BWE-BLOG-GENERATE, in any website project.
---

> `bwe-blog <command>` means `node .bwe-engine/dist/cli/main.js <command>`, run from the website's root. If that file is missing, the engine is not installed: run `/BWE-BLOG-ENGINE install` first.


# BWE-BLOG-GENERATE

1. Run `bwe-blog status`. If the engine is not set up, stop with `/BWE-BLOG-ENGINE install` or `/BWE-BLOG-SETUP`.
2. If there are no recommendations, run `bwe-blog analyze` (or `reanalyze`), then `bwe-blog recommendations` and show the list in plain English.
3. **The owner picks.** Run `bwe-blog select <id...>` only for ids the owner names (within the configured limit); `bwe-blog reject <id...> --note=` for ones they decline.
4. Run `bwe-blog generate` for the selected ids. Articles must be supported by the site's own content; never invent facts, prices, policies or claims.
5. Report what was generated and send the owner to `/BWE-BLOG-REVIEW`. Do not approve or publish.
