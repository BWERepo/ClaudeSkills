---
name: BWEBlog
description: The Blog Engine front door. Reads the current website's real Blog Engine state (bwe-blog status), shows a short status dashboard (stage, what is done, what needs the owner), recommends the ONE best next step with the exact command, then asks before proceeding. Never selects, generates, approves or publishes anything on its own. Use when the user says "blog", "Blog Engine", "work on the blog", "what's next for the blog", "blog status", "where are we with the blog", or invokes /BWEBlog, in any website project.
---

> The Blog Engine runs from the website's own copy, installed by `/BWEBlogInstall` into `.bwe-engine/`. `bwe-blog <command>` below means `node .bwe-engine/dist/cli/main.js <command>` run from the website's root.

# BWEBlog: the Blog Engine front door

**If you don't know what to do next for the blog, run `/BWEBlog`.** It reads the project, says where the blog run stands, and tells you the next step.

```
ANALYZE → REVIEW RECOMMENDATIONS → SELECT → GENERATE → REVIEW AND APPROVE → PUBLISH → REBUILD INDEX
```

## Step 1: read the state (never from memory)

From the website's repository root:

1. If `bwe-blog.config.json` does not exist, the engine is not set up here. The next step is `bwe-blog init` (then set `siteUrl`). If `.bwe-engine/dist/cli/main.js` does not exist, the engine is not installed: the one step is `/BWEBlogInstall`.
2. Otherwise run `bwe-blog status` (read-only; add `--json` if you need to parse it). It prints a summary, what is done so far, the single next action with its command, and anything else worth a look (broken links, orphans, stale index).
3. Sanity-check it against this conversation. If the owner says something the records cannot show ("I published it"), say so and carry on; never edit engine state to match a claim.

## Step 2: tell the owner where things stand (short)

```
Blog run status
Stage: <current>   Next: <next>
Articles: <n> recommended, <n> selected, <n> drafted, <n> published
Needs you:
- <decision only the owner can make>
Next step: <one concrete command>
```

## Step 3: recommend ONE next step and ask

Say what the step will and will not change, and ask before running it.

| Stage reported | Next step |
|---|---|
| Not initialized | `bwe-blog analyze` |
| Analyzed, no recommendations | `bwe-blog reanalyze` |
| Recommendations awaiting selection | `bwe-blog recommendations`, then the owner picks, then `bwe-blog select <id...>` |
| Selected, awaiting generation | `bwe-blog generate` |
| Drafts awaiting review | `bwe-blog admin` (owner reads and approves) |
| Ready to publish | `bwe-blog publish <articleId>` |
| Index stale | `bwe-blog rebuild-index` |
| Up to date | `bwe-blog reanalyze` now and then |

`bwe-blog guide [section]` prints the engine's manual; point the owner to it for detail.

## Rules (always)

- A human decides what to write, whether a draft is good enough, and when to publish. Never run `select`, `approve` or `publish` without the owner's explicit choice of articles.
- Articles must be supported by the site's own content; never invent facts, prices, policies or claims. Honour the site's own quality rules (follow the quality rules in the project's CLAUDE.md).
- Do not deploy, commit or push unless the owner asks. Published content is not live until the site is deployed.
- Keep messages short: current stage, what changed, what is needed from the owner.
