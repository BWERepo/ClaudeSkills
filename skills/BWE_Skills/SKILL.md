---
name: BWE_Skills
description: Lists every BWE skill so the owner can choose one, and creates or edits skills in the shared ClaudeSkills plugin. Use when the user says "list my skills", "which BWE skills are there", "create a new skill", "edit a skill", or invokes /BWE_Skills.
---

# BWE_Skills

The master copy of every BWE skill is `BWERepo/ClaudeSkills` (plugin `bwe-skills`). Never edit a local or account copy as if it were the master.

## list
Read `SKILL-CATALOG.md` in this plugin's root (two folders above this skill) and show skills grouped by family (FAQ, SEO, Blog, OCA, Deploy, other) with one-line descriptions. Ask which one to run.

## create / edit
1. Work on a branch of `BWERepo/ClaudeSkills`. Create or edit `skills/BWE_<Name>/SKILL.md` (frontmatter `name`, `description`). New names start with `BWE_`.
2. Add or update the entry in `catalog-meta.json`; bump `version` in `.claude-plugin/plugin.json` (`yyyy.mm.dd.nn`); add a `CHANGELOG.md` entry; run `python3 scripts/catalog.py && scripts/validate.sh`.
3. Open a PR. After merge, every project gets the change on its next plugin update (`claude plugin marketplace update bwe-skills && claude plugin update bwe-skills@bwe-skills --scope project`, then restart the session).

Never put secrets or one customer's data in a shared skill.
