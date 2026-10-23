# BWE-BLOG-ENGINE version

Read-only. Changes nothing.

1. The plugin root is two folders above this skill's base directory (printed when the skill loads): `../../`. Read the bundled version from `../../engines/blog/VERSION`.
2. Print: `Blog engine bundled in bwe-skills <plugin version>: <engine version>`. The plugin version is `version` in `.claude-plugin/plugin.json`.
3. If the file is missing, say so and stop; do not guess a version.
4. Add one line: /BWE-BLOG-ENGINE install fetches the latest engine from its GitHub repository when it runs, so that can be newer than the bundled copy. For the version installed in a website use `/BWE-BLOG-ENGINE installed`.
