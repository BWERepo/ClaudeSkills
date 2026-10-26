# SEO regression detection

Answers one question: **did something change on the site, since a trusted earlier state, that could damage organic search visibility?**
It compares a saved *observation* of the site with the project's *accepted baseline*. Everything it reports is an **observed technical
state from a crawl** (a page returned 500, carries `noindex`, was removed from the sitemap…). It never says a page *is* or *is not*
indexed by Google: only Search Console knows that (see `google-index-monitoring.md`). Every finding repeats that limit.

Code: `src/regression-detect.mjs` (pure comparison, Worker-safe), `src/regression-workflow.mjs` (exceptions, finding lifecycle,
baseline rules, read model; pure), `src/regression-store.mjs` (local files), `src/regression-collect.mjs` (observation collector,
injected fetch), `src/seo-regression.mjs` (CLI). Customer data (observations, baseline, findings, records, audit) is written only in
the customer's own project, under `seo/data/regression/`; the engine holds no customer data.

## Commands
See `docs/OPERATING-GUIDE.md` §6 for the run-it table. Summary: `status`, `compare`, `findings`, `explain`, `read-model`, `issues`
and `exception list` are **read-only**; `init`, `accept`, `record`, `decision`, `exception add|remove` write under `seo/data/regression/`;
`observe` is the only command that makes network requests (read-only GETs of the site's own pages) and saves an observation file, never a baseline.

Exit codes of `compare` / `record`: `0` no actionable regression (or no baseline yet), `1` regressions detected, `2` not comparable
(unusable or incompatible observation, wrong project/environment/scope, a refused baseline change), `3` usage error or execution failure.

## Observation format (`bweseo.regression.observation`, version 1)
A JSON file: `id`, `project.id`, `observedAt`, `environment {name: production|staging|local, origin}`, `status` (`complete`, `partial`,
`failed`), `scope` (origin, sitemap URLs, include/exclude paths, robots user agent, max pages), `config.importantPaths`, `coverage`
(`discovered`, `fetched`, `failed`, `truncated`, `linkGraphComplete`), `checks.robots` and `checks.sitemap` (each with a `state`), and
`pages` keyed by URL (status, redirect chain, loop flags, meta robots, `X-Robots-Tag`, canonicals, internal links). `null` means *not
captured* (UNKNOWN); an empty list means *captured, none present*. Headers kept are limited to `X-Robots-Tag`; credentials in URLs and
sensitive query values are redacted. A different `version` is rejected as incompatible, not guessed at.

## Baseline and evidence rules
* The baseline (`baseline.json`) is the **accepted** state; the latest observation is separate and never replaces it by itself.
* `init` creates the first baseline; `accept` replaces it. Both need a **complete, valid** observation (status `complete`, not
  truncated, every discovered URL fetched, no fetch failures, readable robots.txt and sitemap) and a named person. `accept` also needs
  a reason, is refused when the observation is not comparable, and is **refused while unresolved regressions exist** unless
  `--acknowledge-regressions` is given. Regressions covered by an approved record do not block acceptance.
* Each accepted baseline gets a sequence number and a hash; the replaced one is copied to `baseline-history/`; `audit.json` records who
  accepted what, why, which findings were acknowledged and which approved records matched. Writes are atomic (temp file + rename), serialized
  by a lock, and ordered history → baseline → audit.
* The first valid run is a baseline, not a comparison: nothing is reported as new. Existing defects stay with the existing checks.
* **Comparison is refused** (exit 2) across environments (never staging vs production), origins, projects, observation versions, or a
  different crawl scope (`includePaths`, `excludePaths`, sitemap URLs, robots agent). `maxPages` and `importantPaths` may differ.
* Insufficient evidence is **UNKNOWN**, never a failure: a page not fetched or timed out, headers not captured, a failed robots.txt or
  sitemap fetch. UNKNOWN is listed per check with the reason and never resolves a finding.

## URL comparison scope
Keys normalize only scheme/host case, default port, fragment, credentials and query-parameter *order*. They keep scheme, host (`www`
vs apex), **path case**, and the **trailing slash** (unlike `seo-page-checks.normalizeUrl`, which drops it), because a change in any of
them is a real change. Internal means the same host as the observation origin. Excluded: other hosts, non-HTTP links, fragments, URLs
outside the configured include/exclude paths. Pages absent from the baseline are not compared (a new page has no "before").

## What is detected
| Finding type | Meaning | Compared when |
|---|---|---|
| `noindex-added` | meta robots or X-Robots-Tag gained noindex/none (Google/Bing or unqualified directives) | page was a direct 200 without it; both captures present |
| `robots-restriction` | a robots.txt rule now blocks pages that were crawlable; grouped per rule; counts sitemap URLs affected | both robots.txt files readable |
| `canonical-missing` / `canonical-conflict` / `canonical-changed` | canonical tag gone / several different / points at another URL (incl. only a trailing-slash difference) | page a direct 200 in both; canonicals captured |
| `page-error` | previously direct-200 page now returns 4xx/5xx | page fetched |
| `unexpected-redirect` | previously direct-200 page now redirects | page fetched |
| `redirect-loop` / `redirect-chain` | revisited URL or hop limit exceeded / more than one redirect hop, where the baseline had none | page fetched |
| `sitemap-removal` | an eligible (200, indexable, self-canonical, unblocked) sitemap URL is no longer listed | every sitemap file readable (or the URL is found) |
| `sitemap-entry-redirected` / `-noncanonical` / `-noindex` | a sitemap URL that was clean became redirected / canonicalised elsewhere / noindex | URL still listed, page fetched |
| `broken-internal-link` | an internal link source → target whose target now returns 4xx/5xx, and was not already broken | source links captured, target fetched |
| `orphaned-page` | an **important** page that had inbound internal links has none | status `complete`, not truncated, link graph complete, coverage ≥ 95% |

One root cause, one finding: a sitemap URL that became noindex / redirected / non-canonical is reported as the sitemap-entry finding,
not also as the page-level one; sitemap URLs blocked by robots.txt are counted inside the `robots-restriction` finding.

## Severity rules (deterministic)
* **critical** — a robots rule blocking the whole site (`Disallow: /`), a rule hitting ≥ 10% (and ≥ 5) of the baseline's eligible pages
  or any important page; noindex, canonical changed, page error, or redirect loop on an **important** page.
* **high** — the same defects on other pages; important-page unexpected redirect, sitemap removal, sitemap-entry defect, canonical
  missing/conflict, broken link to an important page, orphaned important page; any robots restriction below the critical thresholds.
* **medium** — the same lesser defects on other pages; any other broken internal link; redirect chain on an important page.
* **low** — redirect chains on other pages.
Important pages are `config.importantPaths` of the observation (the home page is always important).

## Findings (the contract other tools consume)
Each finding: `id` (`rg-<type>-<10 hex>`, stable: type + affected URL, source→target pair or rule), `type`, `severity`, `subject`
(`url` | `source`+`target` | `rule`), `title`, `impact`, `recommendedAction`, `verification[]`, `previous` and `current`
(`observedAt` + `evidence`), `firstObservedAt`, `lastObservedAt`, `occurrences`, `confidence` (`confirmed` | `limited`) and
`limitations[]` (always including the indexing statement), `status` (`open` | `intentional` | `resolved` | `accepted`), `decision`
(`acknowledged` | `wont-fix`, with who/when/note — human, never changed by a run), `intentionalChange` (matched record) and
`exceptionNotes` (why a covering record did not match). `issues` projects open findings into the shape of `content-inventory`
`issues` (`id`, `title`, `severity`, `area: technical`, `status`, `pages`) plus `source: "regression-detection"`; nothing is written to
the inventory, so an issue queue can consume it without coupling.

Lifecycle: `record` updates by stable id (no duplicates; re-recording the same observation changes nothing); human decisions are kept;
a finding is **resolved only when its own check passes on a usable observation** — a timeout, partial crawl, failed robots/sitemap
fetch or missing header leaves it open ("inconclusive"). A resolved finding that reappears is reopened. A run older than the last
recorded one is refused. `accept` closes the covered findings as `accepted` (history kept).

## Intentional changes
`exception add` records a narrow approval: one exact `--url` or one `--path-prefix` (never `/`), a `--kind`, the expected result, a
`--reason`, `--by`, creation time, and optional `--expires`. Kinds: `removal` (expected 4xx status, default 404/410),
`redirect` (expected target + 301/308), `canonical` (expected canonical), `indexability` (expected loss of indexability via
`noindex`, `robots` or `any`). A record excuses a finding only if it covers the URL **and** the observed result equals the expected
one; a 500 is not an approved removal, a redirect to another target is not an approved redirect, other URLs and other regression
types are never excused (loops, chains, broken links and orphans cannot be excused at all). An expired record excuses nothing and the
finding says so. Matched findings are `intentional` (still visible, not counted as regressions).

## Dashboard read model
`read-model` (and `buildReadModel` in `regression-workflow.mjs`) returns `bweseo.regression.readmodel` v1: baseline summary, finding
counts by status and open severity, finding summaries, intentional-change counts (expired, expiring within 14 days), the last
observation and the recent audit. No hosted dashboard or notification is built in.

## Limits
Rule-based detection from fetched HTML and headers; no JavaScript rendering; the robots.txt evaluation is the engine's own Google-style
parser; `Link:` header canonicals and `hreflang` are not compared; a 5xx may be transient (the finding says so); a crawl that
does not reach a page cannot speak about it.
