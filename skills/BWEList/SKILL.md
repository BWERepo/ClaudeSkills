---
name: BWEList
description: Lists every skill in the bwe-skills catalog as a short grouped table (name and one-line description) with the total count, read from the catalog itself. Read-only. Use when the user says "list skills", "what skills are there", "show the skill catalog", or invokes /BWEList, in any project.
---

# BWEList

Read-only. Changes nothing. Lists the skills of this plugin's catalog, not the skills of the current project (`/BWESkills` does that).

## Steps
1. The plugin root is two folders above this skill's base directory (printed when the skill loads): `../../`. Read `SKILL-CATALOG.md` there. If it is missing, read `skills/*/SKILL.md` in the plugin root and take each `name:` and `description:` from the frontmatter.
2. Shorten each description to ONE plain-English line (about 15 words, the first sentence, no file paths).
3. Group by name prefix, in this order, skipping empty groups: **SEO** (BWESEO*, front door `BWESEO` first), **FAQ** (BWEFAQ*), **Blog** (BWEBlog*), **Design** (BWEImpeccable*, impeccable, BWEWow), **Data** (BWEExport, BWEImport), **One Click Answers** (BWEOCA*, OCA*, BWEDeploy*, BWEE2E*, BWEWorkQueue*), **Other**.
4. Print one table per group: `/bwe-skills:Name` | one-line explanation. End with the total count and the catalog version (`.claude-plugin/plugin.json`).
5. Mark skills the catalog says work only in one project (its "Compatible projects" column) with "(project-specific)".
