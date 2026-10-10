# FAQ Engine: Project Status

## Purpose
The reusable FAQ Engine and its Claude skills: it turns a website's real content into a grounded, collapsible, SEO-aware FAQ system. This repository is the **engine source, not a website**.

- Repo: https://github.com/BWERepo/FAQEngine
- Engine version: see `package.json`
- Start of session: `/BWEFAQBegin` · checkpoint: `/BWEFAQCheckpoint` · wrap-up: `/BWEFAQEnd` · both: `/BWEFAQAll`

## How to run things
```
npm test                       engine tests (node --test)
npm run guide                  print the user manual (-- <section>, -- --list, -- --check for drift)
node src/cli.mjs install <site> [--dry-run|--update|--verify|--sync-skills]
node faq/engine/src/cli.mjs status     (inside an installed site)
```

## Skills
Customer-facing (`skills/`): BWEFAQ (front door and coordinator), BWEFAQInstall, BWEFAQSetup, BWEFAQGenerate, BWEFAQReview, BWEFAQPublish, BWEFAQUpdate.
Maintenance (`.claude/skills/`): BWEFAQBegin, BWEFAQCheckpoint, BWEFAQEnd, BWEFAQAll.

## Design pattern
The workflow and coordinator mirror the SEOEngine pattern: a state-aware front door skill reads real state (`status`) and recommends one next step; dedicated skills for install, setup and each
stage; an installer with dry-run, verify, update and skill sync; a "Show user manual" Actions run with a drift check; maintenance skills for the engine repository.

## Open follow-ups
- Pages must be enabled once in the repository settings (Source: GitHub Actions) for the docs site to publish.
