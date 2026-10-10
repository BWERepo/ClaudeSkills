#!/usr/bin/env bash
# Installs the BWE Blog Engine into the website in the current directory.
#
#   cd /path/to/website && bash <(curl -fsSL https://raw.githubusercontent.com/BWERepo/BlogEngine/main/install.sh)
#   (or, from a clone of this repo:  cd /path/to/website && bash /path/to/BlogEngine/install.sh)
#
# Optional environment variables:
#   BWE_SITE_URL   the site's public address; skips the prompt (e.g. https://www.example.com)
#   BWE_REPO       git URL to fetch the engine from (default: the BWERepo/BlogEngine repo)
#   BWE_REF        branch or tag to install (default: main)
#   BWE_DIR        where the engine is kept inside the site (default: .bwe-engine)
set -euo pipefail

REPO="${BWE_REPO:-https://github.com/BWERepo/BlogEngine.git}"
REF="${BWE_REF:-main}"
DIR="${BWE_DIR:-.bwe-engine}"

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

for tool in node npm git; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required but was not found"
done
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 20 ] || die "Node.js 20 or newer is required (found $(node --version))"

SITE="$(pwd)"
say "Installing the Blog Engine into $SITE"

# 1. Fetch the engine (or update it if it is already there).
if [ -d "$DIR/.git" ]; then
  say "Updating existing engine in $DIR"
  git -C "$DIR" fetch --depth 1 origin "$REF"
  git -C "$DIR" checkout -q FETCH_HEAD
else
  [ -e "$DIR" ] && die "$DIR already exists and is not a git checkout"
  say "Fetching engine ($REF)"
  git clone --depth 1 --branch "$REF" "$REPO" "$DIR"
fi

# 2. Build it.
say "Building the engine"
(cd "$DIR" && npm ci --no-audit --no-fund && npm run build)

# 3. Add it to the site's dependencies (creates package.json only if the site has none).
[ -f package.json ] || { say "No package.json found; creating a minimal one"; npm init -y >/dev/null; }
say "Linking the engine into the site"
npm install --no-audit --no-fund --save "./$DIR"

# 4. Create the config (never overwrites an existing one), then initialize the engine's data folder.
if [ -f bwe-blog.config.json ]; then
  say "bwe-blog.config.json already exists; leaving it as is"
else
  url="${BWE_SITE_URL:-}"
  if [ -z "$url" ] && [ -t 0 ]; then
    read -r -p "Site URL (e.g. https://www.example.com), or press Enter to set it later: " url
  fi
  SITE_URL="$url" node -e '
    const c = process.env.SITE_URL ? { siteUrl: process.env.SITE_URL } : {};
    require("fs").writeFileSync("bwe-blog.config.json", JSON.stringify(c, null, 2) + "\n");'
  [ -n "$url" ] || say "Remember to set \"siteUrl\" in bwe-blog.config.json before analyzing"
fi
npx bwe-blog init

# 5. Keep engine files out of the site's git history.
if [ -d .git ] || [ -f .gitignore ]; then
  for entry in "$DIR/" ".bwe-blog/"; do
    grep -qxF "$entry" .gitignore 2>/dev/null || echo "$entry" >> .gitignore
  done
fi

say "Done. Next:"
npx bwe-blog status || true
