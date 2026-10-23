---
name: BWE-SKILLS-UPDATE
description: Updates the shared BWE skills plugin (bwe-skills) in the current project to the latest version from BWERepo/ClaudeSkills. Refreshes the marketplace, updates the plugin at the scope it is installed with, reports the version before and after, and says when a session restart is needed. Use when the user says "update my skills", "refresh the BWE skills", "get the latest skills", "update the plugin", or invokes /BWE-SKILLS-UPDATE, in any project.
---

# BWE-SKILLS-UPDATE

Runs the two update commands for the `bwe-skills` plugin and reports the result in plain language. Generic: works in any project that has the plugin.

## Steps

1. **Before.** From the project root run `claude plugin list --json` and find the `bwe-skills@bwe-skills` entry that applies here: `scope` `project` or `local` with `projectPath` equal to this project's root (compare case-insensitively on Windows), otherwise a `scope` `user` entry. Note its `version`, `scope` and `enabled`.
   - **Not installed for this project:** say so, show the install commands from the catalog README (`claude plugin marketplace add BWERepo/ClaudeSkills --scope project`, then `claude plugin install bwe-skills@bwe-skills --scope project`), and ask before running them. Do not install without a yes.
   - If the `claude` CLI is missing, say so and stop.
2. **Refresh the marketplace:** `claude plugin marketplace update bwe-skills`.
3. **Update the plugin** at the scope found in step 1: `claude plugin update bwe-skills@bwe-skills --scope <scope>`. Allow a generous timeout (network). If the output asks to confirm a marketplace-declared command, show that command to the user and stop; never pass `-y` or `--accept-command` without the user's explicit yes in this conversation.
4. **After.** Run `claude plugin list --json` again and read the version for the same entry.
5. **Report**, short:
   - `bwe-skills: <before> → <after> (<scope> scope)`, or "already up to date at <version>".
   - If the version changed: "Restart this session (or start a new one) to load the updated skills. Skills in this session are still the old ones."
   - If `enabled` is false for this project: say so and give `claude plugin enable bwe-skills@bwe-skills --scope <scope>`; ask before running it.
   - Project scope: if `git status --porcelain .claude/settings.json` shows a change, say the file changed and should be committed so cloud sessions pick up the same plugin settings. Do not commit for them.
   - Any error: quote the error line and the command that failed. Common causes: no network; the machine or cloud environment cannot read the private `BWERepo/ClaudeSkills` repository (it needs GitHub access to it).

Never edit plugin files, the plugin cache, or skill folders by hand, and never `git pull` inside the plugin folder. Never commit, push or deploy.

## Notes

- Claude Code cloud sessions: plugin auto-update is not verified there, so run this skill at the start of a cloud session when you need the latest skills.
- This skill updates itself along with everything else. The first time, before this skill exists in a project, run the two commands by hand once.
