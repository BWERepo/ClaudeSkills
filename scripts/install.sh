#!/usr/bin/env bash
# Install the catalog into the CURRENT project (run from the project root).
# Usage: install.sh [version-tag]   e.g. install.sh v0.1.0 or v2026.10.20.01  (default: latest main)
set -euo pipefail
ref="${1:-}"
src="BWERepo/ClaudeSkills${ref:+@$ref}"
claude plugin marketplace add "$src" --scope project
claude plugin install bwe-skills@bwe-skills --scope project
claude plugin list | grep -A3 bwe-skills
