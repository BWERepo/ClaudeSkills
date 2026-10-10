# FAQ Engine

A reusable, dependency-free engine that turns a website's **real content** into a useful, grounded, maintainable FAQ system, for any kind of site (services, ecommerce, informational, tools and calculators, SaaS, clubs, content sites).

It never invents answers. Every FAQ it publishes cites text that exists on the site, every number in an answer must appear in that text, and anything it cannot support is held back as **NEEDS REVIEW**.

```
FAQ Engine (this repo, plain Node >= 20, ES modules, zero dependencies)
  inventory      scan a built site (html-dir adapter) or a site-exported JSON file -> one page shape
  candidates     question headings found in pages + candidates authored by a human or Claude (with source quotes)
  grounding      CONFIRMED / DERIVED / UNKNOWN: quotes must exist on the cited page, numbers must be supported
  dedupe         semantic duplicates (synonyms, stems, brand-name-insensitive), not just identical text
  categorize     categories from the SITE's config (keywords/pages); tiny categories fold into a fallback
  links          proposes natural internal links from names an answer already mentions; validates every link
  registry       the FAQs a site owns: stable ids, aliases, statuses, manual-edit protection, update mode
  seo            registry export (id, question, answer, category, page, canonical URL, anchor, related, links,
                 status, created, updated), sitemap paths, FAQPage JSON-LD built from visible items only
  render         framework-neutral HTML (native <details>/<summary>): collapsed categories, search, deep links
  client         ~2 KB vanilla JS: search, deep-link opening, live result count. Page works without it
  validate       errors fail the build (unsupported ACTIVE answers, duplicates, broken links, open-by-default...)

Site-specific (never in the core):   faq/faq.config.json   faq/faq-registry.json   faq/candidates.json
```

## Install into a site, guided by the FAQ Coordinator
The coordinator is a Claude Code skill, `/BWEFAQ`. It reads your site's real state, shows where the run stands, and guides you one step at a time from install to a published FAQ page.
```sh
node path/to/faq-engine/src/cli.mjs install /path/to/site --dry-run      # preview, changes nothing
node path/to/faq-engine/src/cli.mjs install /path/to/site                # engine -> faq/engine/, scaffolds faq/*.json, adds .faq/ to .gitignore
node path/to/faq-engine/src/cli.mjs install /path/to/site --sync-skills  # /BWEFAQ skills -> <site>/.claude/skills
```
Then open the site in Claude Code and run `/BWEFAQ`. Other install modes: `--update` (replace the engine copy, keep site files) and `--verify` (check the copy against its receipt).

Skills (`skills/`): `/BWEFAQ` (front door and coordinator), `/BWEFAQInstall`, `/BWEFAQSetup`, `/BWEFAQGenerate`, `/BWEFAQReview`, `/BWEFAQPublish`, `/BWEFAQUpdate`.
Full guide: [docs/USER_MANUAL.md](docs/USER_MANUAL.md). Coordinator role: [docs/COORDINATOR.md](docs/COORDINATOR.md). Data model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Reruns: [docs/UPDATE_MODE.md](docs/UPDATE_MODE.md).

## Workflow
```
faq-engine status     where the run stands and the one best next step (read-only)
faq-engine scan       inventory of every public page (and the FAQs already on them)
faq-engine propose    candidates -> duplicate check -> grounding -> categories -> link proposals  (.faq/proposal.md; changes nothing)
faq-engine apply      accept what passed; the rest becomes NEEDS REVIEW; existing/hand-edited answers are never overwritten
faq-engine update     scan + propose again later: what changed, what is still accurate, what is obsolete
faq-engine build      write the SEO registry export
faq-engine validate   fail on anything that must not ship
```
Statuses: `ACTIVE` (published) · `DRAFT` · `NEEDS REVIEW` · `RETIRED` (ids and anchors stay reserved).

## Rendering
`renderFaq({ items, organised, cfg })` returns HTML. Categories and questions are **always collapsed on first load**. A search field is added only when the collection reaches `searchThreshold` (default 25); category sections only when there are at least two categories and `categoryThreshold` (default 6) questions. Include `client/faq.css` (every colour is a CSS variable that falls back to the host site's own tokens) and call `initFaq()` from `client/faq-client.js`.

## Tests and docs
`npm test` (Node's built-in test runner; no install step). `npm run guide` prints the user manual (`-- --check` fails if it drifts from the engine). In GitHub, the "Show user manual" workflow displays it on the run page, and "Publish docs" publishes it with Pages. Maintenance skills for this repository: `/BWEFAQBegin`, `/BWEFAQCheckpoint`, `/BWEFAQEnd`, `/BWEFAQAll`.
