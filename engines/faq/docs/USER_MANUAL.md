# FAQ Engine User Manual

For site owners installing and running the FAQ Engine (version 1.0.0). For the data model and internals see [ARCHITECTURE.md](ARCHITECTURE.md); for reruns see [UPDATE_MODE.md](UPDATE_MODE.md).

## 1. What it does

The engine reads your site's real content, helps you build a set of FAQs whose answers are **grounded in text that exists on your site**, and publishes them as an accessible, collapsed-by-default FAQ page with an SEO export.

Key rules it enforces:

- Every published answer cites a quote that must exist on the cited page, and every number, price or percentage in an answer must appear in that source text.
- Anything it cannot support is held back as **NEEDS REVIEW**. It never publishes unsupported answers.
- It never invents questions from templates. Candidates come from question headings already on your pages, plus candidates written by you (or by Claude) with source quotes.
- It never deletes or silently overwrites your FAQs. Changes are proposed first.

It is dependency-free and needs Node 20 or newer.

## 2. Quick start: the guided way

The recommended way is to let the **FAQ Coordinator** guide you. It is the `/BWEFAQ` skill: it reads your site's real state, tells you which step you are on, recommends the one next step, and asks before doing it. You never have to remember the other commands.

Requirements: Node 20 or newer, a checkout of the engine repository (`BWERepo/FAQEngine`), Claude Code opened in your website's folder, and a site you can build to static HTML (or export its pages as JSON).

1. **Install the engine and its skills into your site** (run once, from the engine checkout):
   ```sh
   node src/cli.mjs install /path/to/your-site --dry-run          # review the plan, changes nothing
   node src/cli.mjs install /path/to/your-site
   node src/cli.mjs install /path/to/your-site --sync-skills      # puts the /BWEFAQ skills in your site's .claude/skills
   ```
2. **Open your website's folder in Claude Code and run `/BWEFAQ`.** It shows a status dashboard and the next step. Follow it through the stages:

   | Stage | What happens | Skill |
   |---|---|---|
   | INSTALL | engine copied into `faq/engine/` | `/BWEFAQInstall` |
   | CONFIGURE | you answer a few questions; `faq/faq.config.json` is filled in | `/BWEFAQSetup` |
   | SCAN, PROPOSE | the built site is scanned; candidate FAQs with source quotes are drafted and checked | `/BWEFAQGenerate` |
   | REVIEW, APPLY | you review each proposed FAQ; accepted ones are published to the registry | `/BWEFAQReview` |
   | WIRE PAGE, BUILD, VALIDATE | the FAQ page shows the FAQs; SEO export is built; validation must pass | `/BWEFAQPublish` |
   | PUBLISH | you publish your site the way you normally do | you |

3. **After the site changes**, run `/BWEFAQUpdate`.

You can run `/BWEFAQ` at any point, including in a new session; it works out where you are from the files, not from memory.

## 3. Quick start: by hand

Every step above is also a command. In your site's folder (after installing), each command is `node faq/engine/src/cli.mjs <command>`:

1. Edit `faq/faq.config.json` (see "Configuring your site").
2. Build your site, then run `scan`.
3. Add candidates to `faq/candidates.json` (see "Providing candidates"), or rely on question headings already on your pages.
4. `propose`, then read `.faq/proposal.md`.
5. `apply`, then fix anything left at NEEDS REVIEW.
6. Show the FAQs on a page (see "Showing the FAQs on a page").
7. `build`, then `validate`. Fix errors until it reports 0.
8. Publish your site the way you normally do.

At any time, `status` prints where you are and the one best next step (read-only; add `--json` for tools). Example:

```
FAQ ENGINE STATUS

✓ INSTALL   ✓ CONFIGURE   ✓ SCAN   ✓ PROPOSE   ▸ REVIEW   · APPLY   · WIRE PAGE   · BUILD   · VALIDATE   · PUBLISH

FAQs: 0 ACTIVE, 0 DRAFT, 0 NEEDS REVIEW, 0 RETIRED. Candidates written: 8.
Needs you:
- 8 proposed FAQ(s) are waiting for your review (.faq/proposal.md)

Next step: REVIEW. 8 proposed FAQ(s) need your review before they are accepted.
Skill: /BWEFAQReview
```

## 4. The FAQ Coordinator and the skills

The coordinator role is played by `/BWEFAQ`. It does what a project coordinator would: tracks the stage of the run, lists what needs a human decision, and walks you to the next step. The full role description and a ready-to-paste instruction block are in [COORDINATOR.md](COORDINATOR.md).

| Skill | Use it to |
|---|---|
| `/BWEFAQ` | see status and get the next step (the front door; start here) |
| `/BWEFAQInstall` | install, update, verify the engine, sync the skills |
| `/BWEFAQSetup` | configure the site |
| `/BWEFAQGenerate` | scan, and draft and propose candidate FAQs |
| `/BWEFAQReview` | review the proposal and held items, then apply |
| `/BWEFAQPublish` | wire the page, build the SEO export, validate |
| `/BWEFAQUpdate` | rerun after the site changes |

Skills never skip a review gate, never publish an answer the site does not support, and never deploy. The engine's own maintenance skills (`/BWEFAQBegin`, `/BWEFAQCheckpoint`, `/BWEFAQEnd`, `/BWEFAQAll`) are for people working on the engine repository itself (see "Maintaining the engine").

## 5. Installing

From the engine repository:

```sh
node src/cli.mjs install /path/to/your-site
```

This copies a managed engine (code, client files, docs) into `faq/engine/` with a receipt that records a hash of every file, creates three site-owned files if missing, and adds `.faq/` to `.gitignore`:

| File | Purpose |
|---|---|
| `faq/faq.config.json` | All site-specific settings (see "Configuring your site") |
| `faq/faq-registry.json` | The FAQs your site owns |
| `faq/candidates.json` | Candidate FAQs you or Claude write, with source quotes |

Install modes (all take the website folder; the default is the current folder):

| Flag | What it does |
|---|---|
| (none) | install |
| `--dry-run` | show exactly what would happen; changes nothing |
| `--update` | replace the engine copy with this engine version; your three files are kept |
| `--verify` | check the installed copy against its receipt (missing, modified or unexpected files); changes nothing |
| `--sync-skills` | copy the `/BWEFAQ` skills into `<site>/.claude/skills`; add `--dir <folder>` to use another folder (for example a user-level skills folder), and `--dry-run` to preview. A skill file you edited by hand is a conflict and is left alone. |

Don't edit `faq/engine/` by hand. Run the commands from your site's root; they read `faq/faq.config.json` by default (use `--config <file>` to point elsewhere).

## 6. Configuring your site

Edit `faq/faq.config.json`. Starting template:

```json
{
  "site": { "name": "Your Site", "url": "https://example.com" },
  "adapters": [{ "type": "html-dir", "dir": "dist" }],
  "faqPage": { "path": "/faq", "title": "Frequently asked questions", "description": "" },
  "categories": [
    { "id": "getting-started", "title": "Getting started", "keywords": ["start"], "pages": ["/getting-started"] }
  ],
  "fallbackCategory": { "id": "general", "title": "General questions" },
  "exclusions": { "pages": ["/admin", "/404"], "questions": [] },
  "schema": { "faqPage": true },
  "tokens": {},
  "knownPaths": []
}
```

Main settings (all others keep sensible defaults):

| Setting | What it does |
|---|---|
| `adapters` | Where content comes from. `html-dir`: a built static site folder (`dir`). `json`: a `{ "pages": [...] }` file your site exports, for content that lives in code or a CMS. |
| `faqPage` | Path, title and description of the FAQ hub page (default `/faq`). |
| `categories` | Your categories: `id`, `title`, `keywords`, `pages` (URL prefixes), optional `description`/`order`. Categories are yours; the engine doesn't impose a taxonomy. |
| `fallbackCategory` | Where uncategorized questions go. Categories with fewer than `minCategorySize` (default 2) items are folded into it. |
| `exclusions` | `pages`: URL prefixes never scanned. `questions`: regexes for questions never turned into FAQs. |
| `synonyms`, `dedupe.ignoreTerms` | Teach duplicate detection your vocabulary. Your site's own name is ignored automatically. |
| `searchThreshold` | Search box appears only at this many visible FAQs (default 25). |
| `categoryThreshold` | Below this many FAQs a flat list is shown instead of category sections (default 6). |
| `categoryAnchorPrefix` | Prefix for category anchors (default `category-`). Use `""` to keep legacy `#privacy`-style anchors. |
| `schema.faqPage` | Set `false` if your policy forbids FAQ structured data (see "SEO, sitemap and structured data"). |
| `tokens` | `{{token}}` placeholders usable in answers, such as a contact page name. |
| `linkPolicy` | `maxPerAnswer` (default 2); `auto` (default off). |
| `linkTargets` | `exclude` paths and `aliases` (other names an answer might use for a page). |
| `externalHosts` | External hosts allowed in answer links. Other external links are rejected. |
| `knownPaths` | Paths that exist but aren't in the scan (e.g. `/#find`), so links to them validate. |
| `importPageFaqs` | Import FAQs already on your pages (read-only) so the SEO export sees them. Default on. |
| `linkIndex` | Optionally list imported page FAQs on the hub as a collapsed, searchable index of links. Default off. |

## 7. The workflow

Build your site first (the `html-dir` adapter scans built output), then:

| Command | What it does |
|---|---|
| `status` | Read-only: shows the stages, FAQ counts, what needs you and the one best next step. `--json` for tools. |
| `scan` | Builds the content inventory of every public page (and FAQs already on them) into `.faq/inventory.json`. |
| `propose` | Candidates, duplicate check, grounding, categories and link proposals. Writes `.faq/proposal.json` and a readable `.faq/proposal.md`. **Changes nothing.** |
| `apply` | Accepts the proposal into `faq/faq-registry.json`. Items that passed grounding become ACTIVE; the rest become NEEDS REVIEW. Existing and hand-edited answers are never overwritten. `--drafts-only` adds everything as non-published for you to promote yourself. |
| `update` | `scan` + `propose` in one step, for reruns (see "Updating as the site changes"). |
| `build` | Writes the SEO export to `seo/faq-registry.json`. |
| `validate` | Fails (exit code 1) on anything that must not ship. Use it in your build/CI. |
| `report` | Prints counts and categories from the registry. |

Typical first run: `scan`, `propose`, read `.faq/proposal.md`, `apply`, `build`, `validate`.

### Providing candidates

The engine finds candidates without a language model only from question headings on your pages (a heading ending in `?` followed by a short answer). To add more, write entries in `faq/candidates.json` (or have Claude draft them):

```json
{ "candidates": [
  { "question": "How does the site round money?",
    "answer": "The site rounds to the nearest cent. See [Methodology](/methodology).",
    "sources": [{ "url": "/methodology", "quote": "exact sentence copied from that page" }],
    "relatedPages": ["/methodology"] }
] }
```

`question`, `answer` and `sources` are the essentials. The quote must match text on the cited page, or the item is held for review. Answers are plain text with `[label](/path)` links and optional `{{token}}` placeholders.

## 8. Reviewing the proposal

Open `.faq/proposal.md`. Sections:

- **New FAQs**: each with proposed status, confidence and category, and a review reason if one applies.
- **Merged as duplicates**: candidates dropped because they mean the same as an existing or earlier FAQ (shown with the surviving one).
- **Skipped**: missing question/answer, or excluded by config.
- **Existing FAQs that changed state**: items flagged because their sources changed (see "Updating as the site changes").
- **Link proposals**: suggested internal links where an answer already names another page.
- **Page FAQs repeated across pages**: identical questions on many pages. They are kept (each page needs its own answer) and listed so you can consolidate on purpose.

Read answers that touch money, policy, legal, medical or financial topics yourself. Source-checked is not the same as owner-approved.

### Confidence and statuses

Confidence: **CONFIRMED** (directly supported), **DERIVED** (safely derived), **UNKNOWN** (not supportable; never ACTIVE).

| Status | Meaning |
|---|---|
| ACTIVE | Published: shown on the hub, included in the SEO export and structured data |
| DRAFT | Not published |
| NEEDS REVIEW | Held back, with a `reviewReason` (unsupported number, quote not found, broken link, source changed...) |
| RETIRED | No longer shown; its id and anchors stay reserved so they are never reused |

## 9. Adding and editing FAQs by hand

Edit `faq/faq-registry.json` directly (items have the fields listed in ARCHITECTURE.md), or add a candidate in `faq/candidates.json` and run `propose` / `apply`.

- An item with `"origin": "manual"` is hand-written and is always preserved. An answer you edit after generation is detected and preserved too. Either is flagged only if its supporting source text disappears.
- Ids are assigned once and never change. If you rename a question, add the old anchor to `aliases` so old links keep working.
- To remove an FAQ, set its status to `RETIRED` rather than deleting it.
- After any edit run `build` and `validate`.

## 10. Updating as the site changes

Rebuild the site, then run `update`, read `.faq/proposal.md`, and `apply`. The engine does not regenerate your collection:

- New candidates that duplicate an existing FAQ are merged away; new supported ones are proposed.
- A cited page removed or moved, or cited text changed or removed, flags the FAQ NEEDS REVIEW.
- A page changed but the cited text is still there: the FAQ stays ACTIVE and the change is reported.
- An answer that no longer matches its sources, or contains an unsupported number, is flagged (unless hand-written).
- A broken internal link in an answer is flagged with the link.
- RETIRED items are left alone.
- Nothing is deleted; items are flagged or retired.

## 11. What visitors see

Rendering is framework-neutral HTML: `renderFaq({ items, organised, cfg })` returns markup using native `<details>`/`<summary>`, so it works without JavaScript.

- Categories and questions are **always collapsed on first load**. Category sections appear only with at least two categories and `categoryThreshold` questions.
- A **search field** appears only at `searchThreshold` FAQs or more. It matches question text, answer text, category and keywords, shows a live result count, reveals matches inside collapsed categories, and shows a "no matching questions" message when empty.
- **Deep links** such as `/faq#how-does-the-site-round-money` open the right category and question and scroll to the answer. Old anchors listed in `aliases` still work.
- Questions on other pages (contextual FAQs) come from the same registry through `contexts`/`relatedPages`.

To use it, include `client/faq.css` (every colour is a CSS variable that falls back to your site's own tokens) and call `initFaq()` from `client/faq-client.js` (about 2 KB of vanilla JS). The engine renders no dates, so there are no time displays to localize.

### Showing the FAQs on a page

The engine produces HTML; your site decides where it goes. In your FAQ page template (or a build step that writes the page), call the engine with the registry and drop the result into the page. Plain Node example:

```js
import { loadConfig, loadRegistry, buildAll, renderFaq } from './faq/engine/src/index.mjs';

const cfg = loadConfig('faq/faq.config.json');
const { items, organised, jsonLd } = buildAll(cfg, loadRegistry(cfg), null);
const faqHtml = renderFaq({ items, organised, cfg });   // put this inside your FAQ page
// jsonLd is the FAQPage markup (null/empty when schema.faqPage is false); add it to the page head only if you use it
```

Then on that page:

1. Include `faq/engine/client/faq.css` (or copy its rules into your stylesheet) so the FAQs pick up your site's own colours and fonts through CSS variables.
2. Load `faq/engine/client/faq-client.js` and call `initFaq()` once the page loads. This adds search and deep-link opening; the FAQs still display without it.
3. Make sure the page is at the path set in `faqPage.path` and is in your sitemap.
4. Rebuild and run `validate`. It renders the page itself and fails if anything opens by default, search appears at the wrong size, or schema doesn't match the visible questions.

For a framework site (Astro, Next, Eleventy and so on), do the same inside the page component, or inject the HTML string. To show a few related questions on another page, pass only that page's items to `renderFaq`.

## 12. SEO, sitemap and structured data

`build` writes `seo/faq-registry.json` for your SEO system. For each FAQ: id, question, answer, category, page, canonical URL, anchor, related pages, related tools, links, status, created and updated dates. It also lists categories and pages, so the SEO system can discover the hub, individual questions and categories.

- **Sitemap:** only the hub page is a sitemap path. Questions are anchors, not separate URLs, to avoid thin pages.
- **FAQPage JSON-LD:** built from visible items only, when `schema.faqPage` is `true`. Set it to `false` if your site's policy forbids FAQ markup. Rich results are never guaranteed.
- The engine exports data and helpers; adding the JSON-LD and sitemap entry to your pages is done by your site's own templates.

## 13. Validation

`validate` prints warnings and errors, and exits 1 on errors. Errors include unsupported ACTIVE answers, duplicate questions or ids, broken internal links, and collapsed-by-default violations. Run it in CI. It does not replace testing in a real browser or with a screen reader, or running a structured-data validator on your pages.

## 14. Troubleshooting

| Problem | Check |
|---|---|
| Not sure what to do next | Run `/BWEFAQ` or `status`: it names the one next step |
| Installed engine reported modified | Run `install <site> --verify`; fix with `install <site> --update` (never edit `faq/engine/`) |
| `FAQ config not found` | Run from the site root, or pass `--config` |
| `No proposal. Run: faq-engine propose` | Run `propose` before `apply` |
| `install` says the folder exists | Use `--update` |
| Scan finds few pages | Build the site first; check the adapter `dir` and `exclusions.pages` |
| Nothing proposed | Add candidates to `faq/candidates.json`; headings only yield `?` headings with short answers |
| Item stuck at NEEDS REVIEW | Read its `reviewReason`: quote not on the page, unsupported number, or broken link |
| A good candidate was "merged as duplicate" | It matched an existing FAQ; check the surviving one, or adjust `synonyms` / `dedupe` |
| No search box | Fewer than `searchThreshold` visible FAQs |
| No category sections | Fewer than two categories or under `categoryThreshold` FAQs |
| Many nearly empty categories collapse into General | Raise category coverage or lower `minCategorySize` |
| Old `#anchor` links stopped working | Add the old anchor to the item's `aliases`, or set `categoryAnchorPrefix` to `""` |
| Link rejected in an answer | Add the host to `externalHosts` or the path to `knownPaths` |
| Same question on many pages | Expected; see the repeated-questions list in the proposal |

## 15. Maintaining the engine

For people changing the engine repository itself (not for site owners). Customer websites never write back to it.

| Command | What it does |
|---|---|
| `npm test` | runs the engine tests (Node's built-in runner; no install step) |
| `npm run guide` | prints this manual in the terminal; `npm run guide -- <section>` prints one section, `-- --list` lists headings, `-- --check` fails if the manual no longer matches the engine's commands, flags, scripts and skills |
| `npm run docs` | builds the manual and related docs into a small website in `_site/` (`scripts/build-docs.mjs`; needs the `marked` package, which the docs workflow installs) |

GitHub Actions:

- **Show user manual**: in the repository's Actions tab, choose "Show user manual" and press Run workflow. The manual appears on the run page; give a section number or a heading word to show one section. The same run executes the drift check, so it turns red if the manual and the engine disagree.
- **Publish docs**: builds the manual and related docs and publishes them with GitHub Pages on pushes to `main` that change docs. Enable once under Settings, Pages, Source: "GitHub Actions".

The maintenance skills `/BWEFAQBegin` (resume from `PROJECT_STATUS.md`), `/BWEFAQCheckpoint` (tests plus the drift check), `/BWEFAQEnd` (update `PROJECT_STATUS.md` and commit) and `/BWEFAQAll` (checkpoint, then end) live in the repository's `.claude/skills/` and load when Claude Code is opened there. After changing anything a person runs or follows, update this manual in the same change.

## 16. Not included

- No automatic deployment; deploy your site the way you normally do.
- No built-in screen-reader or structured-data validator runs.
- Question generation needs your candidates (or Claude); the engine will not make up questions.
