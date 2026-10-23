---
name: BWE-BLOG-PUBLISH
description: Publishes approved blog articles through the Blog Engine's validation gate and rebuilds the blog SEO index. Publishes only articles the owner named; never deploys. Use when the user says "publish the blog article", "publish the post", or invokes /BWE-BLOG-PUBLISH, in any website project.
---

> `bwe-blog <command>` means `node .bwe-engine/dist/cli/main.js <command>`, run from the website's root. If that file is missing, the engine is not installed: run `/BWE-BLOG-ENGINE install` first.


# BWE-BLOG-PUBLISH

1. Run `bwe-blog status`. Only approved articles can be published.
2. Run `bwe-blog publish <articleId>` only for articles the owner named. The validation gate may refuse; report its reasons verbatim and do not work around it.
3. Run `bwe-blog rebuild-index`, then `bwe-blog links` and report broken links or orphans.
4. Say that published content is not live until the site is deployed. Do not commit, push or deploy unless the owner asks.
