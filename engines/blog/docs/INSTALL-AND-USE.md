# Installing and using the BWE Blog Engine (plain-language guide)

This guide is for someone setting the engine up on a website for the first time, with no prior
knowledge of this codebase. It covers installing the engine, running it, and using the conductor to
always know what has already happened and what to do next.

If you only remember one thing from this guide: **run `bwe-blog status` whenever you're not sure
what to do next.** It reads the engine's own records and tells you, in plain language, what has
already been done and the exact next command to run.

This guide itself travels with the engine, so it's always available without asking anyone for help:
- `bwe-blog guide` prints the whole guide in the terminal; `bwe-blog guide <section>` prints just one
  section (e.g. `bwe-blog guide "basic workflow"`).
- The admin dashboard has a **Guide** tab with the same content, and `bwe-blog status` (and the
  dashboard's "Where you are" panel) link straight to the section for whatever you should do next.

## 1. What this engine does

The Blog Engine looks at an existing website, figures out what blog content would help it (new
articles, missing internal links, SEO metadata), and writes that content only after a human reviews
and approves it. It never deletes or overwrites a page you already have, and it never publishes
anything on its own unless you've explicitly configured it to (see "Approval modes" below).

## 2. Installing it into a website

### Before you start

- **Node.js 20 or newer** on the machine where you'll run the engine (`node --version` to check).
- **A copy of the website's files** (the project folder, or its built output). The engine reads and
  writes files there. If the site is a CMS or database with no files you can reach, see "Sites without
  a checkout" below.
- *(Optional)* an **AI provider key** if you want real AI-written drafts (see "Choosing who writes
  the drafts" below). Without one, the engine uses a built-in offline writer that only produces
  structural scaffolds, which can't be published.

### Step by step

1. Open a terminal **in the root folder of the website's project** (the folder with its
   `package.json`, `index.html` or content folders).
2. Install the engine:

   ```bash
   npm install @bwe/blog-engine    # or: copy this repo's dist/ output and package.json dependency
   ```

3. Create the config file:

   ```bash
   npx bwe-blog init
   ```

   This writes `bwe-blog.config.json` and creates the engine's private data folder (`.bwe-blog/` by
   default). It does not touch any of your existing pages.
4. Open `bwe-blog.config.json` and set at least `siteUrl`, the website's real address, e.g.
   `"siteUrl": "https://www.example.com"`. Everything else has a sensible default and can be left
   alone for a first run.
5. Check it worked:

   ```bash
   npx bwe-blog status
   ```

   A fresh install reports that the website hasn't been analyzed yet and suggests `bwe-blog analyze`.
   That message means the install is good.

Installing never changes your existing site files. Only the config file and the `.bwe-blog/` data
folder are added; you may want to add `.bwe-blog/` to your `.gitignore` if you don't want engine state
committed.

### Settings people most often change

| Setting | What it does | Default |
|---|---|---|
| `siteUrl` | The site's public address (required) | none |
| `blogPath` | Where blog pages live on the site | `/blog` |
| `maxRecommendations` | Ceiling on proposed articles (never a quota) | `50` |
| `approvalRequired` | `true`: a human approves every draft. `false`: passing drafts publish automatically | `true` |
| `generation.provider` | Who writes the drafts (see below) | `deterministic` (offline) |
| `storage.articlesDir` / `storage.publicDir` | Override where new articles are written, if auto-detection picks the wrong place | auto-detected |

See [BLOG_ENGINE.md](../BLOG_ENGINE.md) for every setting.

### Choosing who writes the drafts

Set `generation.provider` in the config, for example:

```json
"generation": { "provider": { "id": "anthropic", "apiKeyEnv": "ANTHROPIC_API_KEY" } }
```

`id` can be `anthropic`, `openai`, `openai-compatible` (a self-hosted/local model, with `baseUrl`), or
`deterministic`. The config holds only the **name** of the environment variable; put the key itself in
that variable (`export ANTHROPIC_API_KEY=...`), never in the file. The engine refuses to run if a key
appears in the config.

### Sites without a checkout

If you can only reach the live site (for example a CMS), the engine can still analyze it by crawling
over HTTP, but it needs somewhere to write new articles. Set `storage.articlesDir` and
`storage.publicDir` to a real folder, and publish those files to the site the way you normally deploy.

## 3. The basic workflow

The engine works in stages, and a human makes every decision that matters (what to write, whether a
draft is good enough, when to publish). The stages are:

1. **Analyze** — the engine reads the website and figures out what's there.
2. **Review recommendations** — the engine proposes articles it thinks would help; nothing is
   written yet.
3. **Select** — you choose which recommendations to actually write (up to a configured limit — this
   is a ceiling, not a quota; selecting fewer is fine).
4. **Generate** — the engine writes drafts for what you selected, adds internal links, and runs
   validation checks.
5. **Review and approve** — a human reads each draft (in the admin dashboard, see below) and approves
   it, or asks for changes.
6. **Publish** — once approved, the article goes live on the site.
7. **Rebuild the index** — after publishing, the engine refreshes its SEO index of blog content.

You never have to remember which of these steps you're on — that's what the conductor (next section)
is for.

### Creating a blog page, step by step

Here is the whole path from nothing to a live page. After every step, `bwe-blog status` tells you
where you are.

1. **Analyze the site.** `bwe-blog analyze` reads your pages and reports how many it found and how
   many article opportunities it identified. Nothing is written yet.
2. **Look at the recommendations.** `bwe-blog recommendations` lists each proposed article with an
   id, priority and title. Ideas that would duplicate something you already have are flagged rather
   than hidden. Not every idea deserves an article; the list is a menu, not a to-do list.
3. **Select the ones you want.** `bwe-blog select <id> <id>`. To discard ideas, use
   `bwe-blog reject <id>`. Nothing is ever written for an idea you didn't select.
4. **Generate drafts.** `bwe-blog generate` writes a draft for each selected idea, adds internal links
   where a natural phrase already exists, and runs the validation checks. Failures are reported with
   the reason.
5. **Review each draft.** Run `bwe-blog admin` (see the admin dashboard section below), open the
   **Articles** tab and read the draft, its validation warnings and its link suggestions. If it isn't
   good enough, reject it; fix the cause (for example the topic or the provider) and generate again.
6. **Approve.** In the dashboard, or `bwe-blog approve <article-id>`.
7. **Publish.** `bwe-blog publish <article-id>` runs the final validation gate and writes the page
   (Markdown or HTML, matching your site) and adds it to the sitemap. Errors block publishing;
   warnings are shown to you but don't.
8. **Rebuild the index.** `bwe-blog rebuild-index` refreshes the SEO index, sitemap and internal-link
   report. `bwe-blog status` will say when this is due.
9. **Deploy your site** the way you normally do, so the new files go live. The engine only writes
   files into your project; it doesn't deploy for you.

If you set `approvalRequired: false`, steps 5 to 7 happen automatically for drafts that pass every
check.

## 4. Using the conductor: progress so far and the next step

After `init`, run:

```bash
bwe-blog status
```

This prints:
- A one-line summary of where things stand.
- A short list of what's already been done (analyzed, how many recommendations exist, how many
  articles are drafted, published, etc).
- The single next recommended action, with the exact command to run.
- Anything else worth a look (broken links, articles with no inbound link, a stale SEO index) that
  isn't blocking you but you may want to handle.

Run `bwe-blog status` again after any step — it always re-reads the engine's actual records, so it's
never out of date and never a second source of truth to keep in sync by hand.

For scripting or dashboards, `bwe-blog status --json` prints the same information as JSON.

The same information is shown automatically at the top of the admin dashboard's Overview tab (see
below), under "Where you are," including a short activity log of what the engine has done recently.

### What the conductor tracks

The conductor is the engine's built-in guide. It keeps no notes of its own: each time you ask, it
works out the current stage from the engine's real records, so it can't drift out of date. It never
selects, generates, approves or publishes anything; it only tells you what's next.

| Stage it reports | What it means | Next step it suggests |
|---|---|---|
| Not initialized | The site hasn't been analyzed yet | `bwe-blog analyze` |
| Analyzed | Analysis exists but no recommendations yet | `bwe-blog reanalyze` |
| Recommendations awaiting selection | Ideas are ready for you to choose from | `bwe-blog recommendations`, then `select` |
| Selected, awaiting generation | You've chosen ideas; no drafts yet | `bwe-blog generate` |
| Drafts awaiting review | Drafts exist and need a human decision | `bwe-blog admin` |
| Ready to publish | Approved articles are waiting | `bwe-blog publish <id>` |
| Index stale | Published content changed since the last index | `bwe-blog rebuild-index` |
| Up to date | Nothing pending | `bwe-blog reanalyze` now and then |

A typical first run looks like:

```bash
bwe-blog status            # "The engine has not analyzed this website yet." -> bwe-blog analyze
bwe-blog analyze
bwe-blog status            # recommendations are ready -> bwe-blog recommendations
bwe-blog recommendations   # list what was proposed
bwe-blog select <id> <id>  # pick the ones you want
bwe-blog status            # selected, not generated yet -> bwe-blog generate
bwe-blog generate
bwe-blog status            # drafts awaiting review -> bwe-blog admin
bwe-blog admin             # open the dashboard, review and approve drafts
bwe-blog publish <id>      # once approved
bwe-blog status            # index is stale -> bwe-blog rebuild-index
bwe-blog rebuild-index
bwe-blog status            # up to date
```

## 5. The admin dashboard

```bash
export BWE_BLOG_ADMIN_TOKEN=some-long-random-value
bwe-blog admin
```

Then open `http://127.0.0.1:4777` (or whatever `admin.port`/`admin.host` your config sets) and paste
the token in. The Overview tab leads with the same "Where you are" panel `bwe-blog status` prints, so
you can start there whether you prefer the command line or the browser. The other tabs let you review
recommendations, read and approve drafts, inspect internal links, and check the BWESEO integration
status.

## 6. Approval modes

- **Mode A (default, `approvalRequired: true`)** — every generated article needs a human to approve it
  in the dashboard before it can be published.
- **Mode B (`approvalRequired: false`)** — an article that passes every validation check publishes
  automatically right after it's generated. Use this only once you trust the content quality for a
  given site; the conductor still reports what happened either way.

## 7. Re-running analysis later

Run `bwe-blog reanalyze` periodically (weekly or monthly is reasonable) to pick up new pages, find new
content gaps, and flag older articles that might need a refresh. `bwe-blog status` will tell you when
it's worth doing.

## 8. Getting unstuck

- `bwe-blog report` prints the engine's full raw state as JSON, if you need more detail than `status`
  gives you.
- `bwe-blog links` summarizes link suggestions, orphan articles, and broken links.
- See [BLOG_ENGINE.md](../BLOG_ENGINE.md) for architecture, every configuration option, the full
  article lifecycle, the BWESEO integration, and how tests are organized.
