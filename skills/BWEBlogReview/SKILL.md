---
name: BWEBlogReview
description: Guides the owner through reviewing and approving generated blog drafts, using the Blog Engine's admin dashboard and link report. Approves only on the owner's explicit say-so. Use when the user says "review the blog drafts", "approve the article", or invokes /BWEBlogReview, in any website project.
---

> `bwe-blog <command>` means `node .bwe-engine/dist/cli/main.js <command>`, run from the website's root. If that file is missing, the engine is not installed: run `/BWEBlogInstall` first.


# BWEBlogReview

1. Run `bwe-blog status` and list the drafts awaiting review (`bwe-blog report` for detail).
2. Offer `bwe-blog admin` (a local dashboard where the owner reads each draft) and `bwe-blog links` (link suggestions, orphans, broken links).
3. Summarize each draft's claims against the site's own content and flag anything unsupported. Do not edit a draft to make it pass.
4. Run `bwe-blog approve <articleId> --by=<owner name>` only when the owner explicitly approves that article.
5. Next step: `/BWEBlogPublish`.
