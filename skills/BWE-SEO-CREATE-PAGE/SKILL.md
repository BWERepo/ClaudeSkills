---
name: BWE-SEO-CREATE-PAGE
description: Creates exactly ONE user-approved SEO page in the current website project using the BWE-SEO engine — rechecks cannibalization, confirms intent, outlines, builds a claims ledger against verified business facts, writes original content in the site's existing design, adds metadata, schema, internal links, CTA and sitemap entry, runs build/tests and SEO QA, and reports without deploying. Refuses if the page isn't approved in seo/content-inventory.json. Use when the user says "create the page", "build the approved SEO page", or invokes /BWE-SEO-CREATE-PAGE <page id or URL>, in any website project.
---

> `$BWESEO_ENGINE` = the BWE-SEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWE-SEO-CREATE-PAGE

1. Project guard (`/BWE-SEO` Step 0).
2. **Approval gate.** Find the page (argument = inventory id or URL). Its status must be
   `approved` with `approvedBy: "user"`. If the user approved it in this conversation but the
   inventory isn't updated yet, update it first (only for that page). Otherwise STOP and ask.
   One page per run.
3. Follow `$BWESEO_ENGINE/docs/methodology/page-creation.md` steps 1–15, with:
   - `content-standards.md` (voice, banned phrases, no fabrication),
   - the industry guide, the adapter (how to add a page in this stack),
   - `conversion.md`, `internal-linking.md`, `structured-data.md`, `answer-engine-readiness.md`.
4. Build the **claims ledger**; any claim without a `verified` fact → ask the user or remove it.
5. Run the project's build, tests and `node seo/tools/validate-seo-data.mjs`; then run the
   `/BWE-SEO-QA` checklist on the page and fix failures.
6. Set the inventory entry to `review` (with title, created, lastReviewed, relatedPages, cta,
   claims, qa). Record state (`docs/methodology/workflow-state.md`): set `lastModifiedOn` (today) and `source` (every file the page is built
   from — the state tool fingerprints them to tell when QA goes stale). If the build had to stop for
   a missing fact, keep `draft` and record the question (`blockedBy`). It becomes `published` only after it's deployed to production.
7. Change report: files, target intent, claims ledger, QA table, user checks (mobile/visual),
   and the deploy command from `seo-config.json` → `workflows` for the user to approve.

Follow the project's own deploy convention only when the user asks (some projects auto-deploy to
staging after every change — respect what the project's instructions say).

8. Set `verifyText` (a sentence only this page has) and `linksFrom` (planned inbound pages) on the
   inventory entry. Next: `/BWE-SEO-QA <id>`; where the project has staging, then the staging deploy
   and the staging review (`/BWE-SEO-QA <id> staging`) and the owner's staging approval. After the
   user's go and the deploy to **production**, the next step is always `/BWE-SEO-PUBLISH <id>` — never
   describe the page as indexed, indexable on production, or ready for Google before that check
   passes, and never suggest indexing a staging URL.
