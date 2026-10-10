#!/usr/bin/env bash
# Validates manifest, skill frontmatter, catalog sync, and version/CHANGELOG agreement.
set -euo pipefail
cd "$(dirname "$0")/.."
claude plugin validate .
python3 scripts/catalog.py --check
v=$(python3 -c 'import json;print(json.load(open(".claude-plugin/plugin.json"))["version"])')
grep -q "^## \[$v\]" CHANGELOG.md || { echo "CHANGELOG.md has no entry for $v"; exit 1; }
for d in skills/*/; do [ -f "$d/SKILL.md" ] || { echo "missing SKILL.md in $d"; exit 1; }; done
echo "OK: bwe-skills $v"
