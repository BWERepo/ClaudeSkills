---
name: BWEListGlobalSkills
description: Prints a nicely formatted list of every skill in the bwe-skills catalog, grouped by area, each with its invocation name and a one-line description, plus the total and catalog version. Read-only. Use when the user says "list skills", "list the skills", "what skills are there", "show the skill catalog", or invokes /BWEListGlobalSkills, in any project.
---

# BWEListGlobalSkills

Read-only. Changes nothing. Lists the skills of this plugin's catalog, not the skills of the current project (`/BWEListProjectSkills` does that).

## Steps
1. The plugin root is two folders above this skill's base directory (printed when the skill loads): `../../`. Read `SKILL-CATALOG.md` there and `.claude-plugin/plugin.json` for the version. If the catalog is missing, read `skills/*/SKILL.md` in the plugin root and take each `name:` and `description:` from the frontmatter.
2. Write ONE plain-English line per skill (about 15 words, the first sentence of its description, no file paths, no machine paths).
3. Group by name prefix, in this order, skipping empty groups, each with a heading showing its count: **SEO** (`BWESEO` front door first), **FAQ** (`BWEFAQ` first), **Blog** (`BWEBlog` first), **Design** (BWEImpeccable*, impeccable, BWEWow), **Data** (BWEExport, BWEImport), **One Click Answers** (BWEOCA*, OCA*, BWEDeploy*, BWEE2E*, BWEWorkQueue*), **Other**. Within a group, sort alphabetically after the front door.
4. Print each group as a heading followed by a two-column table: `/bwe-skills:Name` | one-line description. Mark skills the catalog lists as working only in one project or repository with "(project-specific)" at the end of the line.
5. End with one line: `N skills · catalog version <version>`.
