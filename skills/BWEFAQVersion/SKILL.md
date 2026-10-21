---
name: BWEFAQVersion
description: Shows the version of the FAQ engine bundled in this plugin (the version /BWEFAQInstall would install from here). Read-only. Use when the user says "faq engine version", "which faq engine version do we have", or invokes /BWEFAQVersion, in any project.
---

# BWEFAQVersion

Read-only. Changes nothing.

1. The plugin root is two folders above this skill's base directory (printed when the skill loads): `../../`. Read the bundled version from `version` in `../../engines/faq/package.json`.
2. Print: `FAQ engine bundled in bwe-skills <plugin version>: <engine version>`. The plugin version is `version` in `.claude-plugin/plugin.json`.
3. If the file is missing, say so and stop; do not guess a version.
4. Add one line: /BWEFAQInstall fetches the latest engine from its GitHub repository when it runs, so that can be newer than the bundled copy. For the version installed in a website use `/BWEFAQInstalledVersion`.
