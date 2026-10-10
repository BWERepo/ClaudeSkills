# @bwe/blog-engine

A reusable, framework-agnostic Blog + SEO internal-linking engine: install it into any website, let it
analyze what's there, review its recommendations, and generate only the articles a human selects.

See [docs/INSTALL-AND-USE.md](./docs/INSTALL-AND-USE.md) for a plain-language, step-by-step guide to
installing the engine on a website and using it day to day (including the conductor's `bwe-blog status`
command, which always tells you what's been done and what to do next).

See [BLOG_ENGINE.md](./BLOG_ENGINE.md) for architecture, configuration, the article lifecycle, the
recommendation and linking processes, the BWESEO integration, security notes and testing.

## Install into a website (one command)

From the root folder of the website (needs Node 20+ and git):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/BWERepo/BlogEngine/main/install.sh)
```

Or from a clone of this repo: `bash /path/to/BlogEngine/install.sh`. It fetches and builds the engine
into `.bwe-engine/`, adds it to the site, runs `bwe-blog init`, asks for the site URL and prints
`bwe-blog status`. Set `BWE_SITE_URL` to skip the prompt, `BWE_REF` to pin a branch or tag. Re-running
it updates the engine and keeps your existing config. (The repo is private, so `git` must be able to
authenticate; if the `curl` form returns 404, use a clone instead.)

## Develop the engine itself

```bash
npm install
npm run build
npx bwe-blog init
npx bwe-blog analyze
```
