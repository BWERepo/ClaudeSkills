# BWE-SKILLS list

Read-only. Changes nothing. Lists the skills of this plugin's catalog, not the skills of the current project (`/BWE-SKILLS list` does that).

## Steps
1. The plugin root is two folders above this skill's base directory (printed when the skill loads): `../../`. Read `SKILL-CATALOG.md` there and `.claude-plugin/plugin.json` for the version. If the catalog is missing, read `skills/*/SKILL.md` in the plugin root and take each `name:` and `description:` from the frontmatter.
2. Write ONE plain-English line per skill (about 15 words, the first sentence of its description, no file paths, no machine paths).
3. Group by name prefix, in this order, skipping empty groups, each with a heading showing its count: **SEO** (`BWE-SEO` front door first), **FAQ** (`BWE-FAQ` first), **Blog** (`BWE-BLOG` first), **Design** (BWE-IMPECCABLE*, impeccable, BWE-WOW), **Data** (BWE-EXPORT, BWE-IMPORT), **One Click Answers** (BWEOCA*, OCA*, BWEDeploy*, BWEE2E*, BWE-OCA-QUEUE*), **Other**. Within a group, sort alphabetically after the front door.
4. Print each group as a heading followed by a two-column table: `/bwe-skills:Name` | one-line description. Mark skills the catalog lists as working only in one project or repository with "(project-specific)" at the end of the line.
5. End with one line: `N skills · catalog version <version>`.
