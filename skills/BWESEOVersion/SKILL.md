---
name: BWESEOVersion
description: Shows the version of the SEO engine bundled in this plugin (the version /BWESEOInstall would install from here). Read-only. Use when the user says "seo engine version", "which seo engine version do we have", or invokes /BWESEOVersion, in any project.
---

# BWESEOVersion

Read-only. Changes nothing.

1. The plugin root is two folders above this skill's base directory (printed when the skill loads): `../../`. Read the bundled version from `../../engines/seo/VERSION` (the same value is `engineVersion` in `../../engines/seo/engine-manifest.json`).
2. Print: `SEO engine bundled in bwe-skills <plugin version>: <engine version>`. The plugin version is `version` in `.claude-plugin/plugin.json`.
3. If the file is missing, say so and stop; do not guess a version.
4. Add one line: /BWESEOInstall fetches the latest engine from its GitHub repository when it runs, so that can be newer than the bundled copy. For the version installed in a website use `/BWESEOInstalledVersion`.
