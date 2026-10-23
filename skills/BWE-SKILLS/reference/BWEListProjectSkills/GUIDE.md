# BWE-SKILLS list

Read-only. Builds the list from what is actually installed, never from a memorised list. Changes nothing.

## Steps
1. Find the skill folders. Use the repository root (the folder that holds `CLAUDE.md`) and read `.claude/skills/*/SKILL.md`. Also include any skill whose name starts with `BWE` (case does not matter) that appears in your own available-skills list but has no folder here (account or plugin skills).
2. Keep skills whose folder name starts with `BWE` (case-insensitive), plus `BWE-IMPECCABLE` (also `bweimpeccable`). Match names case-insensitively, so `bweimpeccable` and `BWE-IMPECCABLE` are the same.
3. For each, take the `description:` line of its SKILL.md frontmatter and shorten it to ONE plain-English line (about 15 words, the first sentence, no paths such as `Z:\`).
4. Group by prefix:
   - **Session and release**: skills with Begin, End, Checkpoint, All, Git or Backup in the name
   - **Deploy and tests switches**: skills with Deploy or E2E in the name
   - **Work queue**: skills with WorkQueue in the name
   - **SEO** (BWE-SEO*): put the front door `BWE-SEO` first, then the rest; list the SEO Install shortcuts together
   - **FAQ** (BWE-FAQ*), **Blog** (BWE-BLOG*)
   - **Design** (BWE-IMPECCABLE)
   - **Data** (BWE-EXPORT, BWE-IMPORT)
   - **Other** BWE skills that fit nowhere above, and BWE-SKILLS list itself
5. Print one table per group: `/Name` | one-line explanation. End with the total count.
6. If no `.claude/skills/` folder exists, fall back to `docs/SKILLS.md` and say the list came from that file, which may lag the installed skills.
7. If an installed skill has no description, show it with "(no description)" instead of guessing.

Note which skills need the owner's Windows machine only when their description says so. In a cloud session nothing is deployed.
