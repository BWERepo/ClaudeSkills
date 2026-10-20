---
name: BWEOCABegin
description: Start-of-session resume for the One Click Answers tool site (OneClickAnswers.com) — reads PROJECT_STATUS.md and continues development from where the last session left off. Use when the user says "let's continue", "pick up where we left off", "start of session", or invokes /BWEOCABegin, in the context of the One Click Answers project (Z:\Backup\websites\OneClickAnswers).
---

# BWEOCABegin

> **Where it runs (local or cloud):** `Z:\Backup\websites\OneClickAnswers` below is the owner's local Windows checkout and is optional. In any other checkout (a cloud Claude Code project, Linux or macOS) use the repository root, the folder that holds `CLAUDE.md`; nothing in this skill needs the `Z:` drive. See docs/CLAUDE-PROJECT-MIGRATION.md.

When this skill is invoked, treat it exactly as if the user sent this message:

> Read "Z:\Backup\websites\OneClickAnswers\PROJECT_STATUS.md" and continue development from where we left off.

Carry out that instruction directly. Read `PROJECT_STATUS.md` and `CLAUDE.md`, following `CLAUDE.md`'s pointer to the
standard prompts (`docs/WORKFLOW.md`). Get oriented on the current state (what's on staging vs production, open items), then resume. If the
next step is unclear, summarize the state back to the user and ask what they'd like to work on rather than guessing.

## Orienting facts

- **What it is:** OneClickAnswers.com, an ad-supported site of free single-purpose tools. Each tool has its own
  pre-rendered, indexable page. It is not a small-business lead site.
- **Hosting:** Cloudflare Workers, static assets only. DNS for `oneclickanswers.com` is on Cloudflare.
  - Staging: `staging.oneclickanswers.com`, Worker `oneclickanswers-staging`. Deploy after every change with a patch bump
    in `version.json` (`npm run deploy:staging`) in LOCAL sessions only; a cloud session never deploys and hands its
    work over through a pull request (docs/WORKFLOW.md "Local and cloud sessions").
  - Production: `oneclickanswers.com`, Worker `oneclickanswers`. Deploy only through `/BWEOCACheckpoint` or `/BWEOCAAll`.
- **Indexing is inverted from the BWE prototypes.** Staging is noindex, but production must be indexable. Never let a
  noindex header, meta tag or robots rule reach production.
- **Stack:** Astro static build to `./dist`. If `package.json` doesn't exist yet, the site hasn't been scaffolded.
  Wait for the user's build prompt, and don't pick tools from the research spreadsheets yourself.
- **No invented facts:** no fake usage counts, ratings or testimonials. The research spreadsheets' volumes and CPCs are
  mostly modeled estimates and must never appear on the site as facts.
