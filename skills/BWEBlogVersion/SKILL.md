---
name: BWEBlogVersion
description: Shows the version of the Blog engine bundled in this plugin (the version /BWEBlogInstall would install from here). Read-only. Use when the user says "blog engine version", "which blog engine version do we have", or invokes /BWEBlogVersion, in any project.
---

# BWEBlogVersion

Read-only. Changes nothing.

1. The plugin root is two folders above this skill's base directory (printed when the skill loads): `../../`. Read the bundled version from `../../engines/blog/VERSION`.
2. Print: `Blog engine bundled in bwe-skills <plugin version>: <engine version>`. The plugin version is `version` in `.claude-plugin/plugin.json`.
3. If the file is missing, say so and stop; do not guess a version.
4. Add one line: /BWEBlogInstall fetches the latest engine from its GitHub repository when it runs, so that can be newer than the bundled copy. For the version installed in a website use `/BWEBlogInstalledVersion`.
