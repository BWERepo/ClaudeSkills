---
name: BWE-OCA-ANSWER
description: Create or update one "What Is?" answer in the One Click Answers Answer Engine (Z:\Backup\websites\OneClickAnswers) and prepare it for STAGING review. Never publishes to production. Use when the user invokes /BWE-OCA-ANSWER "What is RGB?" or asks to add or update an OCA answer page.
---

# BWE-OCA-ANSWER

> **Where it runs (local or cloud):** `Z:\Backup\websites\OneClickAnswers` below is the owner's local Windows checkout and is optional. In any other checkout (a cloud Claude Code project, Linux or macOS) use the repository root, the folder that holds `CLAUDE.md`; nothing in this skill needs the `Z:` drive. See docs/CLAUDE-PROJECT-MIGRATION.md.
>
> **Cloud sessions:** step 8 does not apply. Do not deploy; say NOT deployed (cloud session) and hand the work over through a pull request (see docs/WORKFLOW.md "Local and cloud sessions").

Usage: `/BWE-OCA-ANSWER "What is RGB?"`. Read `docs/ANSWER_ENGINE.md` first (architecture, schema, "HOW TO ADD A NEW OCA ANSWER", quality rules). Project: `Z:\Backup\websites\OneClickAnswers`.

Workflow (stop and ask the owner at any step that needs a decision):
1. **Does it already exist?** Search `src/answers/content.ts`, `src/registry/answer-opportunities.ts` (the backlog is NOT authorisation to build) and the blog (`src/blog/posts*.ts`) for the same question. If it exists, update it; if a blog post covers it, say so and keep both with different intent unless told otherwise.
2. **Related OCA tools.** Find Tool Registry ids (`src/registry/*.ts`). Only use ids that exist; a tool that is OFF or rejected on production is left out automatically.
3. **Reusable engines.** Find an engine for the "Try it" example (`src/answers/demos.ts` lists them). If none exists and a useful demo needs a new formula, build the engine first with independent known-answer tests, and ask the owner before building a new tool. No demo and no worked example means the answer is too thin: do not build it.
4. **Research and sources.** Use authoritative primary references (U.S. government or regulators for money, RFCs/standards for technical topics). Name them (title, publisher); never copy text, never link outward. Never invent search volume, difficulty or CPC (they stay null).
5. **Write the registry entry** in `src/answers/content.ts`: plain-English `shortAnswer` (1 to 3 sentences, answer first), SEO title (<= 65) and description (50 to 165), aliases, sections, worked example, related tools and answers (only ones that exist), sources, `reviewedDate` today, `status: 'staging'`, `indexable: true`. Money topics: educational wording, labelled estimates, no advice, no guarantees. 12-hour times only.
6. **Add the demo** (reuse a kind or extend `demos.ts` calling a shared engine) and tests in `tests/answers.test.ts` with hand-worked expected values.
7. **Run:** `npx vitest run tests/answers.test.ts`, `npm run registry:export`, `npm run audit` (ANSWER ENGINE section must be OK), `npm run check`. Run the BWE-SEO check (`/BWE-SEO`) against the new page. Do not run the browser suite while `.e2e-disabled` exists.
8. **Stage:** `npm run deploy:staging` (unless `.deploy-disabled` exists, then say NOT deployed). Show the staging URL `https://staging.oneclickanswers.com/what-is/<slug>`.
9. **Report** per the work-reporting rules in `docs/WORKFLOW.md`: what changed, files, real test results, what was NOT verified (real devices, source titles re-checked against the publisher).

Hard rules: **never** set `status: 'production'`, edit `publication.ts`, run `npm run deploy -- --confirm` or release; production needs the owner's explicit approval and `/BWE-OCA-CHECKPOINT`. Do not edit the shared BWE-SEO engine from the project.
