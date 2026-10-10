# Architecture

## Page shape (the inventory contract)
Every adapter produces pages of this shape; nothing downstream knows how the site stores its content.
```
{ url, title, type, category, description,
  headings:[{level,text,id}], sections:[{heading,level,text}], text, links:[href],
  faqs:[{q,a}],            // FAQs already on the page (imported read-only as contextual FAQs)
  schemaTypes:[...], updated, indexable, hash }
```
Adapters (`adapters` in config):
- `html-dir`: scans a built static site folder. Detects `<title>`, meta description, `noindex`, headings/sections, links, nested `<details>` questions, JSON-LD types (`WebApplication`->tool, `BlogPosting`->article, `Product`, `Service`...) and the breadcrumb section. Blocks the engine rendered itself (`class="faq-engine"`) are ignored so its output never feeds back in.
- `json`: `{ "pages": [...] }` exported by the site, for content that lives in code or a CMS.

## FAQ item (registry)
`id` (stable, assigned once) · `anchor` · `aliases` (old anchors that keep working) · `question` · `answer` (plain text, `[label](/path)` links, `{{token}}` placeholders) · `category` · `status` · `origin` (`manual` | `authored` | `heading` | `page`) · `confidence` (CONFIRMED | DERIVED | UNKNOWN) · `page` (where it lives) · `contexts` (other pages that show it) · `relatedPages` · `relatedTools` · `keywords` · `sources:[{url, quote, hash, verified}]` · `reviewReason` · `manualEdit` · `answerHash` · `created` · `updated`.

## Stages
1. **inventory** (`inventory.mjs`): adapters -> pages, exclusions applied.
2. **candidates** (`propose.mjs`): authored candidates (`faq/candidates.json`) and optional `headings` generator. The engine never fabricates a question from a template; filler is a non-goal.
3. **duplicate control** (`dedupe.mjs`): tokens are stemmed, stop-worded and folded through synonym groups (built in + `config.synonyms`); the site's own name and `dedupe.ignoreTerms` are ignored. Questions match at Jaccard >= 0.72, or similar question + near-identical answer. Candidates are checked against the registry, earlier candidates and (informationally) page FAQs.
4. **grounding** (`grounding.mjs`): a cited quote must exist on the cited page; sentence-level overlap against the cited pages; every number/price/percentage must appear in them. CONFIRMED / DERIVED / UNKNOWN. UNKNOWN is never ACTIVE.
5. **categorize** (`categorize.mjs`): config categories by keyword and page prefix; `minCategorySize` folds nearly empty categories into the fallback; below `categoryThreshold` questions a flat list is used.
6. **links** (`links.mjs`): proposes a link where an answer already names another page (never to itself, max `maxPerAnswer`); `auto` is off by default; `checkLinks` validates internal links against the inventory and rejects external hosts not allowed in config.
7. **registry** (`registry.mjs`): ids, statuses, update mode (see UPDATE_MODE.md).
8. **seo** (`seo.mjs`): registry export, sitemap paths (the hub only; questions are anchors), `FAQPage` JSON-LD from the visible items only, gated by `schema.faqPage`.
9. **render** (`render.mjs`) + **client**: collapsed-by-default accessible markup, optional search, deep links.
10. **validate** (`validate.mjs`): the ship gate.

## Site-specific vs core
Core (`src/`, `client/`) contains no site names, routes or terminology (a test in the host site can assert this). Everything a site decides lives in `faq/faq.config.json`: adapters, categories, link aliases, exclusions, synonyms, thresholds, schema policy, tokens, known paths. Tokens whose value lives in site code (for example a contact address) are filled by a thin wrapper through `main(args, { config })`.
