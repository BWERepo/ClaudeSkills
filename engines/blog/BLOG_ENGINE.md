# BWE Blog Engine

A reusable, framework-agnostic blog and SEO internal-linking engine. Point it at a website's checkout,
and it inventories what's there, finds content gaps, proposes articles for a human to approve, generates
and links only what was approved, validates, and publishes — then keeps its own SEO index, sitemap and
internal links up to date as the site changes. It is not specific to any one site: the engine contains no
company names, domains, categories or framework assumptions. Everything site-specific comes from
configuration or from what the engine discovers on disk.

## Architecture

```text
src/
├── core/
│   ├── analyzer/        site profile, TF-IDF similarity index
│   ├── inventory/       page classification, existing-article detection
│   ├── recommendations/ content gaps, cannibalization, candidate ideas, scoring
│   ├── clusters/        topical clusters (pillar + supporting articles)
│   ├── generator/       article briefs, prompts, quality checks, link restriction
│   ├── linking/         anchor finding, link scoring, the link graph
│   ├── registry/        the article registry (the lifecycle state machine's data)
│   ├── workflow/        the lifecycle state machine itself
│   ├── validation/      the publish gate; the refresh evaluator
│   ├── seo/              schema.org, sitemap XML, the Blog SEO Index, JSON Schemas
│   ├── render/           article/listing page rendering (host-template aware)
│   ├── store/             JSON persistence, the owned-files registry
│   ├── html/              HTML parsing, extraction, sanitization
│   ├── content/           Markdown/frontmatter parsing and rendering
│   ├── util/              hashing, slugs, URLs, text, the safe filesystem
│   └── engine/            orchestration: analyze, build, rebuild, the BlogEngine facade
├── adapters/
│   ├── host-site/        filesystem and HTTP site adapters, stack detection
│   ├── content-storage/  Markdown and HTML publishing adapters
│   ├── ai-provider/       Anthropic, OpenAI, OpenAI-compatible, deterministic
│   └── bweseo/             the BWE SEO Engine integration adapter
├── admin/                 the admin dashboard (Node http server + static dashboard)
├── cli/                   bwe-blog command-line tool
schemas/                   JSON Schemas for the Blog SEO Index and the discovery file
tests/                     unit, integration, regression, e2e + two reference site fixtures
```

`core/` is completely site-agnostic. `adapters/` is where site-specific knowledge lives (how to read a
particular kind of site, how to write to it, how to talk to an AI provider or to BWESEO). The engine never
embeds a domain, a brand, or a hard-coded category: see [Portability](#portability).

## Installation

```bash
npm install @bwe/blog-engine
npx bwe-blog init          # writes bwe-blog.config.json for the current directory
npx bwe-blog analyze       # inventory, recommend, and stop (nothing is generated yet)
```

See [docs/INSTALL-AND-USE.md](./docs/INSTALL-AND-USE.md) for a non-expert, step-by-step walkthrough of
installing the engine on a real website and working through the full analyze → review → select →
generate → approve → publish cycle with the conductor (`bwe-blog status`).

Or embed it:

```ts
import { BlogEngine } from "@bwe/blog-engine";

const engine = await BlogEngine.create({ siteUrl: "https://www.example.com" });
const analysis = await engine.analyze();
// … human reviews analysis.recommendations via engine.recommendations() …
await engine.select(["rec-abc123"]);
const build = await engine.generate(["rec-abc123"]);
```

## Configuration

Only `siteUrl` is ever required; everything else is discovered or defaulted. Conceptually:

```ts
{
  siteUrl: "https://www.example.com",
  blogPath: "/blog",
  maxRecommendations: 50,        // a ceiling, never a quota
  approvalRequired: true,        // Mode A: review required. false = Mode B: approved selection publishes.
  preserveExistingContent: true, // always true; the engine never deletes or overwrites what it did not write
  enableInternalLinking: true,
  enableSchema: true,
  enableBlogIndex: true,
  blogIndexPath: "/blog-seo-index.json",
  bweSeoIntegration: {
    enabled: true,
    discoveryPath: "/.well-known/bwe-blog.json",
  },
}
```

See `src/config/config.ts` for the full `BlogEngineConfig` shape (`host`, `storage`, `sitemap`, `linking`,
`generation`, `authors`, `schema`, `categories`, `refresh`, `admin`). `resolveConfig` validates and throws a
single `EngineError("CONFIG_INVALID", …)` listing every problem. Secrets are never put in config: AI
provider keys and the admin token are read from environment variables named in config
(`generation.provider.apiKeyEnv`, `admin.tokenEnv`), never from the config file itself; `looksLikeSecret`
refuses to resolve a config that appears to contain one.

## Host adapters

- **`FileSystemHostAdapter`** reads a site checkout: built/served HTML (any framework, after its own
  build) plus Markdown/MDX source files. `detectStack` recognizes ~15 frameworks (Next.js, Astro, Nuxt,
  SvelteKit, Gatsby, Remix, Docusaurus, Hugo, Jekyll, plain HTML, …), CMSs, databases and hosting providers
  from `package.json` and config files, to steer output/content directory discovery — detection, never a
  requirement; an unrecognized stack still works as plain HTML plus Markdown.
- **`HttpHostAdapter`** crawls a running site over HTTP (same-origin only, robots-respecting) for sites
  with no accessible checkout, or backed by a CMS/database rather than files. Read-only; publishing from
  this adapter requires `storage.articlesDir`/`storage.publicDir` pointing at a real checkout, since there
  is nowhere else to write new articles.

## Article lifecycle

```text
recommended → selected → generating → draft → review → approved → published
                  ↓          ↓           ↓        ↓         ↓          ↓
               rejected   error      rejected  rejected  draft    archived/draft/review
```

`workflow/workflow.ts` is the single source of truth for which transitions are legal
(`canTransition`/`assertTransition`). An article can reach `published` only from `generating` directly (Mode
B, once the gate passes) or from `approved` (Mode A's explicit publish step) — never any other way, and
never without `validated: true`. Existing articles (`source: "existing"`) can never be transitioned by the
engine at all: the engine discovers and indexes them, but their publication state is the host's alone.

**Mode A (`approvalRequired: true`, the default):** generated articles land in `draft`, a human reviews and
`approve`s, then `publish` runs the gate and writes the file. **Mode B (`approvalRequired: false`):** once
selected and generated, a passing article is published automatically — selecting it was the approval.

## Recommendation process

1. **Inventory** every page (`core/inventory`), classified by type (product, service, blog-article, …) and
   normalized (canonical, robots, schema, internal/external links, word count, key terms).
2. **Profile** the site (`core/analyzer/profile.ts`): primary subject, offerings, audience, geographic
   market — inferred from the content itself, never configured.
3. **Content gaps** (`core/recommendations/gaps.ts`): offerings with no supporting article, questions
   raised on the site but never answered in depth, missing how-tos/comparisons/pillars, thin topic clusters.
4. **Candidates** (`core/recommendations/candidates.ts`) turn each gap into one or more concrete ideas, tied
   to a real page or question — nothing is proposed that the site's own content doesn't support.
5. **Cannibalization** (`core/recommendations/cannibalization.ts`) flags ideas that would duplicate an
   existing article or another candidate, with a recommended action
   (`do-not-create` / `expand-existing` / `consolidate` / `differentiate` / `supporting-subtopic`).
6. **Score and cap** (`core/recommendations/recommend.ts`): weak ideas are dropped, not padded, and the
   list is capped at `maxRecommendations` (default 50, **a ceiling, never a target**).
7. **Human selects.** Nothing is generated until a human calls `select()` (CLI `select`, admin "Create
   selected", or the `BlogEngine.select()` API).

`searchVolume` and `keywordDifficulty` are always the literal string `"Unknown"` unless a real data source
supplied a number — the engine never fabricates SEO metrics, full stop.

## Internal linking

`core/linking/linker.ts` plans suggestions in three directions:

- **Blog → Blog** and **Blog → Site**: scored by topical similarity (TF-IDF, `core/analyzer/similarity.ts`),
  shared intent, cluster membership, category and target importance (`core/linking/scoring.ts`), then
  banded against configurable thresholds (default 90 / 75 / 60 = excellent / strong / optional).
- **Site → Blog**: only into non-protected, informational pages, and only when `linking.allowSiteToBlogEdits`
  is explicitly enabled — commercial/transactional copy (`PROTECTED_PAGE_TYPES`) is **never** auto-edited.

A suggestion is only auto-applied when the engine owns the source content, scores above
`linking.autoApplyMin`, and a natural anchor phrase is already present in the text
(`core/linking/anchors.ts`) — nothing is force-inserted into prose that doesn't already mention the topic.
Every article gets at most `linking.maxLinksPerArticle` added links, each target gets at most
`linking.maxLinksPerTarget` incoming links from one pass, and anchor text is varied across uses. Orphans
(published articles with zero inbound links) and broken links (`core/linking/graph.ts`) are always
reported, never silently ignored.

## Validation gate

`core/validation/gate.ts` runs before anything reaches `published`: valid + unique URL, no offline-draft or
quality failure, valid title, canonical self-reference, metadata present, no duplicate slug, no
near-duplicate or same-intent content, every internal link resolves, schema.org validates, sitemap
inclusion succeeds, Blog SEO Index inclusion succeeds, and basic responsive checks (viewport meta, no
fixed oversized widths, wrapped tables, alt text, one H1). Warnings reach the reviewer; only errors block
publication — the full list is always returned, never just a pass/fail.

## SEO Index, discovery and sitemap

`/blog-seo-index.json` (`blogIndexPath`) is the authoritative, versioned, machine-readable list of every
blog article — contract documented in `schemas/blog-seo-index.schema.json`
(draft 2020-12, `schemaVersion` `"1.x"`, additive-only within a major version). The **public** variant lists
only published articles; an **internal** variant (kept under the engine's data directory) also lists every
other status and the open recommendation opportunities, for other BWE tooling in the same project.
`/.well-known/bwe-blog.json` (`bweSeoIntegration.discoveryPath`, schema in
`schemas/bwe-blog-discovery.schema.json`) is a small, predictable pointer to the index, the sitemap, and the
blog root — not a substitute for normal SEO signals.

Sitemap handling (`core/engine/rebuild.ts`) adapts to what the host already has: a recognized build-plugin
sitemap generator is left alone (and reported); an existing sitemap **index** gets a dedicated
`blog-sitemap.xml` child; an existing single `urlset` gets the blog's entries merged in (new articles
added, existing lastmod only ever moved forward, engine-owned URLs that are no longer public removed); a
site with none gets one created. Only published, indexable, canonically-self-referencing articles are ever
listed.

## BWESEO integration

The Blog Engine integrates with BWE SEO Engine (**BWESEO**) through an isolated adapter
(`src/adapters/bweseo/bweseo.ts`) rather than building a competing system or hard-coding assumptions about
BWESEO's internals:

- It maps each blog article onto BWESEO's own page-inventory shape (`toBwseoPage`), tagging every entry it
  writes with a `blogEngine: { managed: true, articleId, status }` extension block, so it only ever edits
  entries it owns and only ever **attaches facts** (never overwrites) to entries BWESEO already tracks.
- Status mapping: `published → published`, `rejected → rejected`, in-progress states → `planned`;
  `archived` and `recommended` are excluded from BWESEO's inventory entirely.
- `checkBwseoCompatibility` runs the same checks BWESEO 1.10.0's own `validateInventory` would apply to the
  fields this adapter writes; on any mismatch, the adapter reports `incompatible` and **refuses to write**
  rather than risk corrupting BWESEO's data.
- `bweSeoIntegration.syncInventory` is **off by default** — until explicitly turned on, the adapter only
  inspects and reports (`not-installed` / `compatible` / `incompatible`, with counts of what it would add,
  update, link or retire); nothing is written to BWESEO's inventory file.
- The BWE SEO Engine repository itself is never modified by this project; see the project's own notes for
  what BWESEO would need to add to consume this adapter's output, should that integration be pursued.

## Operations

| Action | CLI | API |
|---|---|---|
| Analyze (stop before generating) | `bwe-blog analyze` | `engine.analyze()` |
| Reanalyze (report what changed) | `bwe-blog reanalyze` | `engine.reanalyze()` |
| Select / Reject | `bwe-blog select <id…>` / `reject <id…>` | `engine.select()` / `engine.reject()` |
| Generate selected | `bwe-blog generate [id…]` | `engine.generate()` / `engine.buildAndReport()` |
| Approve / Publish | `bwe-blog approve <id>` / `publish <id>` | `engine.approve()` / `engine.publish()` |
| Rebuild Blog SEO Index | `bwe-blog rebuild-index` | `engine.rebuildIndex()` |
| Admin dashboard | `bwe-blog admin` | — |
| Status / next step (the conductor) | `bwe-blog status` (`--json` for machine-readable) | `engine.conductorStatus()` |

`bwe-blog status` (`core/conductor/conductor.ts`) is a thin, read-only layer over the state above: it
derives where an installation is (not yet analyzed, recommendations awaiting selection, selected,
drafts awaiting review, ready to publish, published, index stale, up to date) from `analysis.json`,
`recommendations.json`, the article registry, `links.json` and `state.json` — it stores no phase of its
own — and reports what's been done, the single next recommended action with its exact command, and
recent activity read back from the engine's existing `events.jsonl`. It never generates, selects,
approves or publishes anything itself. The same data backs the "Where you are" panel at the top of the
admin dashboard's Overview tab and the `GET /api/conductor-status` endpoint.

`docs/INSTALL-AND-USE.md` (the plain-language install/usage guide) is bundled into the npm package
(`package.json` "files") and read at runtime by `src/docs/guide.ts`, so it's available without any
network access or interaction with Claude: `bwe-blog guide` prints it (or one section, by id or title
match) in the terminal, the admin dashboard has a **Guide** tab rendering it as HTML
(`GET /api/guide`), and each conductor next-action links to the relevant section
(`nextAction.guideSection`).

`Rebuild Blog SEO Index` (`core/engine/rebuild.ts`) never regenerates content: it re-scans, validates URLs,
recomputes relationships/links/orphans, updates hashes, regenerates the index, updates the sitemap, and
re-runs validation — nothing else. `Reanalyze Website` (`engine.reanalyze()`) determines what changed (new
pages, removed pages, changed commercial offerings, obsolete or new recommendations) without creating
anything automatically.

## Article refresh

Published articles are flagged, never auto-rewritten (`core/refresh/refresh.ts`): a linked page's content
changed, a broken link was found, a new related page appeared with no link to it yet, the text names a
year that now reads as stale ("in 2022", "as of 2023", …), or the article hasn't been reviewed within
`refresh.reviewIntervalDays`. `refreshRecommended` and `refreshReason[]` are set; nothing rewrites content
because it's simply old.

## Security

- **Path safety** (`core/util/safe-fs.ts`): every write is confined to the site root and an explicit
  allow-list of directories, resolved through symlinks so a symlink can't escape the root; `.env`/`.git`
  paths are always refused.
- **Overwrite safety**: a file is replaced only when its on-disk hash still matches what the engine itself
  last wrote (`OwnedFiles`) — the moment a human edits a file the engine owns, the engine stops touching it.
  There is no delete: archiving moves a file into the data directory and records a backup; `SafeFs.restore`
  can roll any write back.
- **Untrusted content**: crawled HTML, frontmatter and AI output are all treated as untrusted. HTML output
  goes through an allow-list sanitizer (`core/html/sanitize.ts`); site text handed to an AI provider is run
  through `neutralizeUntrusted` (`core/generator/injection.ts`), which fences it as data and flags anything
  that reads like an embedded instruction, surfaced to the reviewer as a `prompt-injection` validation
  warning rather than silently acted on.
- **Admin auth**: every admin API request needs a bearer token read from an environment variable (never
  config, never logged), compared in constant time; state-changing requests also require a custom header a
  cross-site form post cannot set.
- **Secrets**: `looksLikeSecret` refuses to resolve a configuration that contains what looks like an API
  key or private key; provider keys and the admin token are always environment-variable references.

## Pluggable AI providers

`generation.provider.id`: `"anthropic"`, `"openai"`, `"openai-compatible"` (self-hosted/local, via
`baseUrl`), or `"deterministic"` — an offline, dependency-free provider used for tests, demos, and as a
structural writing scaffold. Deterministic drafts are blocked from publication
(`generation.publishDeterministicDrafts` must be explicitly set for tests) because they have no knowledge
beyond the brief. Swapping providers never touches an `BlogArticle` record's shape; `generatedBy` just
records `"<provider>:<model>"`.

## Testing

```bash
npm run typecheck
npm test                 # all suites
npm run test:unit        # slugs, hashing, URLs, registry transitions, link scoring, index schema
npm run test:integration # analyze/import, generate→publish (both approval modes), rebuild-index
npm run test:regression  # installing the engine never changes the existing site's own files
npm run test:e2e         # Analyze → Recommend → Select → Generate → Review → Publish → Sitemap →
                          # Blog Index → Internal Links → BWESEO Discovery, end to end
npm run build
```

Two reference fixtures under `tests/fixtures/sites/` stand in for "any website": `static-with-blog` (plain
HTML, an existing blog article, sitemap and robots.txt) and `markdown-no-blog` (an Astro-shaped site with no
blog yet). Tests copy a fixture into a temp directory first — nothing under `tests/fixtures` is ever
mutated by a test run.

## Portability

The engine contains no site-specific assumptions: no company names, hard-coded domains, categories, colors,
or framework requirements. `siteUrl`, `blogPath` and every other site fact come from configuration or
discovery (`detectStack`, `buildInventory`, `buildProfile`). The same build installs, unmodified, into a
static HTML site, a Next.js/Astro/Nuxt/SvelteKit/Gatsby app, a plain-Markdown repo, or a site crawled over
HTTP because there's no accessible checkout at all — a dentist's site, an HVAC company, an ecommerce store,
a car club, a recipe blog, or anything else.

## Engine versioning

`ENGINE_VERSION` (`src/version.ts`, currently `1.0.0`) is attached to every generated article
(`BlogArticle.engineVersion`) and to the Blog SEO Index and discovery file. `INDEX_SCHEMA_VERSION` and
`DISCOVERY_SCHEMA_VERSION` version the document *shapes* independently of the engine's own release number,
so a consumer can tell "newer engine, same index shape" apart from "the index shape itself changed."
`DATA_SCHEMA_VERSION` guards the engine's own persisted state (`JsonStore` refuses to read data written by a
newer schema than it understands, rather than silently misinterpreting it).
