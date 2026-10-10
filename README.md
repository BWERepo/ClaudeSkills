# BWE Skills (ClaudeSkills)

Single authoritative Claude Code plugin (`bwe-skills`) holding shared skills. See `SKILL-CATALOG.md` for the list. Current version: see `.claude-plugin/plugin.json` and `CHANGELOG.md`.

Each Claude Code project (and each Claude account / cloud environment) installs the plugin itself; user-level skills in `~/.claude/skills` are NOT shared across accounts or cloud containers. Skills run as `/bwe-skills:<SkillName>`.

## 1. Install in an existing project
From the project root, commit the result so cloud sessions pick it up:
```
claude plugin marketplace add BWERepo/ClaudeSkills --scope project
claude plugin install bwe-skills@bwe-skills --scope project
git add .claude/settings.json && git commit -m "Add bwe-skills plugin"
```
Pin a version: `claude plugin marketplace add BWERepo/ClaudeSkills@v0.1.0 --scope project`.
Private repo: the machine/cloud environment needs GitHub access to `BWERepo/ClaudeSkills`.
Skill names are namespaced, so they do not collide with project skills in `.claude/skills/`; project skills are never overwritten.

## 2. Install in a new project
Same commands after `git init` / cloning. `scripts/install.sh [tag]` wraps them.

## 3. Update a shared skill
Edit `skills/<Name>/SKILL.md` on a branch, bump `version` in `.claude-plugin/plugin.json`, add a `CHANGELOG.md` entry, run `python3 scripts/catalog.py && scripts/validate.sh`, open a PR, merge, tag `vX.Y.Z`.
Consumers: `claude plugin marketplace update bwe-skills && claude plugin update bwe-skills@bwe-skills --scope project`, then restart the session.
Auto-update is NOT verified in cloud environments; treat updates as explicit.

## 4. Add a shared skill
Create `skills/<Name>/SKILL.md` (frontmatter `name`, `description`), add an entry to `catalog-meta.json`, then follow step 3. Only generic, non-proprietary, non-secret skills belong here; project-specific skills stay in that project's `.claude/skills/`.

## 5. Remove a skill
Delete `skills/<Name>/`, remove it from `catalog-meta.json`, bump the version (note the removal in `CHANGELOG.md`), regenerate the catalog, validate, release.

## 6. Roll back
Pin to a prior tag: `claude plugin marketplace remove bwe-skills`, then `claude plugin marketplace add BWERepo/ClaudeSkills@v0.1.0 --scope project`, then `claude plugin update bwe-skills@bwe-skills --scope project`. Commit settings. To disable entirely: `claude plugin uninstall bwe-skills@bwe-skills --scope project`.

## Compatibility
Requires a Claude Code version supporting `claude plugin` (tested with 2.1.296). `scripts/validate.sh` runs `claude plugin validate`, catalog sync and changelog checks.

## Excluded from release 0.1.0
See `docs/MIGRATION.md`.
