---
name: BWE_Skills
description: Lists every BWE skill so the owner can choose one, and creates or edits skills in the shared ClaudeSkills repository. Works entirely from Claude desktop, no terminal. Use when the user says "list my skills", "which BWE skills are there", "create a new skill", "edit a skill", or invokes /BWE_Skills.
---

# BWE_Skills

The master copy of every BWE skill is `BWERepo/ClaudeSkills`. The owner works only in Claude desktop and never types terminal commands; do the work with GitHub tools and ask for approval in the thread. Never edit a local or account copy as if it were the master.

## list
Read `SKILL-CATALOG.md` from `BWERepo/ClaudeSkills` (GitHub file read) and show skills grouped by family (FAQ, SEO, Blog, OCA, Deploy, other) with one-line descriptions. Ask which one to run.

## create / edit
1. Work on a branch of `BWERepo/ClaudeSkills`. Create or edit `skills/BWE_<Name>/SKILL.md` (frontmatter `name`, `description`). New names start with `BWE_`.
2. Add or update the entry in `catalog-meta.json`, bump `version` in `.claude-plugin/plugin.json` (`yyyy.mm.dd.nn`) and add a `CHANGELOG.md` entry. Regenerate `SKILL-CATALOG.md` from the catalog data if you can run the catalog script; otherwise say it still needs regenerating.
3. Open a PR for the owner to review and merge.
4. Tell the owner how the change reaches their projects: the merged repo is the master, and each project picks it up when its skills are refreshed from the repo.

Never put secrets or one customer's data in a shared skill.
