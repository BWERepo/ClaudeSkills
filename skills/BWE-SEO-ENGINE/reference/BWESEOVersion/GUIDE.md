# BWE-SEO-ENGINE version

Read-only. Changes nothing.

1. The plugin root is two folders above this skill's base directory (printed when the skill loads): `../../`. Read the bundled version from `../../engines/seo/VERSION` (the same value is `engineVersion` in `../../engines/seo/engine-manifest.json`).
2. Print: `SEO engine bundled in bwe-skills <plugin version>: <engine version>`. The plugin version is `version` in `.claude-plugin/plugin.json`.
3. If the file is missing, say so and stop; do not guess a version.
4. Add one line: /BWE-SEO-ENGINE install fetches the latest engine from its GitHub repository when it runs, so that can be newer than the bundled copy. For the version installed in a website use `/BWE-SEO-ENGINE installed`.
