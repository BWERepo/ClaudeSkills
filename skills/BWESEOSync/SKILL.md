---
name: BWESEOSync
description: One command to bring the current website project up to the newest BWESEO engine — refreshes the bwe-skills plugin, then (after a restart if the plugin changed) runs the website update and verify. Use when the user says "sync the engine", "get the new engine", or invokes /BWESEOSync, in a website project that has BWESEO installed.
---

> `$BWESEO_ENGINE` = the BWESEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).

# BWESEOSync

Invoking this skill is the owner's go-ahead for steps 1 to 3. Step 4 follows `/BWESEOInstallUpdate` exactly, including its dry run and its stop on conflicts.

1. Note the plugin version now running: `version` in `.claude-plugin/plugin.json` two levels above this skill's base directory, and the bundled engine version in `$BWESEO_ENGINE/VERSION`.
2. Refresh the plugin (needs the `claude` CLI and network; report any error and stop):
   `claude plugin marketplace update bwe-skills` then `claude plugin update bwe-skills@bwe-skills --scope project`.
3. Check what the update fetched (its output, or the plugin's `plugin.json` in the plugin cache). If the plugin version changed, the skills in THIS session are still the old ones.
   Tell the owner exactly: "The plugin updated from <old> to <new>. Restart this session, then run /BWESEOSync again." Then **stop**.
4. If the plugin was already current: invoke `BWESEOInstallUpdate` via the Skill tool (dry run first if the owner has not seen one this conversation; report conflicts as REVIEW REQUIRED and stop for the owner), then `BWESEOInstallVerify`.

Finish with one line: the website's engine version versus the bundled version, and whether verify passed. Never touch the website's profile, config, inventory or state; those belong to the update skill's rules.
