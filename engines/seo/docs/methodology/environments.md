# Environments — local, staging, preview, production (engine 1.3.0)

Every SEO step happens in one environment, and every BWESEO skill says which one. The environment
decides what is allowed — above all, whether search engines may be involved.

```
LOCAL  →  STAGING  →  HUMAN REVIEW  →  PRODUCTION  →  GOOGLE
build it   test it     you approve     customers and    request discovery /
                                       search engines   indexing, then monitor
                                       see it
```

| Environment | What it is | Search engines |
|---|---|---|
| **LOCAL** | The project files on this machine (`npm run dev`, a local build) | Not relevant — nothing local is public |
| **STAGING** | The project's test copy of the site | **Never.** Must be hidden from search engines |
| **PREVIEW** | Temporary per-change deployments (if the project has them) | **Never.** Same as staging |
| **PRODUCTION** | The real website customers use | Indexable wherever intended — the only place indexing actions apply |
| **UNKNOWN** | A host the project's config doesn't name | Treated as non-production |

## The hard rule

**STAGING MUST NEVER BE SUBMITTED TO SEARCH ENGINES FOR INDEXING.** No skill ever recommends, for
a staging, preview, local or unknown URL:

- Google Search Console URL Inspection / Request Indexing
- a sitemap submission that contains such URLs (or submitting a staging sitemap at all)
- IndexNow, Bing URL submission, or any other search-engine indexing request

When any skill runs against a non-production URL it says, prominently:

```
ENVIRONMENT: STAGING
SEARCH ENGINE INDEXING ACTIONS: DISABLED
This environment is for testing only.
Do not request indexing for this URL.
```

`tools/seo-state-core.mjs` → `indexingAllowed(environment)` is true only for PRODUCTION; both
tools build on it.

## Configuration — `seo-config.json` → `environments`

Record only what is verified (from the repo's deploy configuration, the hosting account's
settings the owner shows you, or a live request). Never guess a URL.

```json
"environments": {
  "production": { "url": "https://www.example.com", "hosts": ["www.example.com", "example.com"],
                  "deploy": "<the project's production workflow>" },
  "staging":    { "status": "configured", "url": "https://staging.example.com",
                  "hosts": ["staging.example.com", "<platform hostname, e.g. *.workers.dev>"],
                  "deploy": "<the project's staging workflow>",
                  "indexProtection": "<how staging is hidden: X-Robots-Tag / noindex / sign-in / robots.txt>" },
  "preview":    { "status": "not-configured", "hostPatterns": [] },
  "local":      { "urls": [], "run": "<how to run it locally>" }
}
```

- `production.url` equals the config's `website`. `hosts` lists every host that serves production
  (apex + www).
- `staging.status`: `configured`, `not-configured` (the project really has no staging — say so; never
  fabricate one) or `unknown` (not investigated yet — `/BWESEOSetup` finds out).
- `staging.hosts`: every host that serves the staging copy, including platform hostnames. These
  are what the leak checks look for in production output.
- `preview.hostPatterns`: exact hosts or `*.example.net` patterns, only when the project really uses
  preview deployments.
- A host may never be both production and staging (the validator refuses it).
- Pre-1.3.0 configs (`production`/`staging` as plain URL strings, `publication.stagingHosts`) are
  still read; the validator warns until they're moved.

Hosts that are always LOCAL: `localhost`, `*.localhost`, `*.test`, `*.local`, `127.*`, `10.*`,
`192.168.*`, `172.16–31.*`, `::1`.

## Index protection

| Environment | Desired result | How to check |
|---|---|---|
| PRODUCTION | Indexable wherever intended | Home page + each page: no `noindex` in `<meta name="robots">`, `googlebot` or `X-Robots-Tag`; robots.txt doesn't block `User-agent: *` from `/` |
| STAGING / PREVIEW | Not for indexing | Strong: every response says `noindex` (X-Robots-Tag header or meta) **or** needs a sign-in. Weak: only robots.txt `Disallow: /`. None: nothing |
| LOCAL | Not relevant | — |

**robots.txt alone is weak.** It stops polite crawlers from *fetching* staging pages, but a staging
URL linked from anywhere can still be listed in results (without a description). The strong
signals are `X-Robots-Tag: noindex` on every response (works for every file type, and doesn't
depend on the page's HTML) or HTTP authentication. Choose what fits the project's architecture and
put the owner's choice in `staging.indexProtection`. Keeping robots.txt `Disallow: /` alongside
noindex is a trade-off: Google can't crawl a disallowed page to *see* its noindex, but crawlers
that ignore noindex (some AI bots) are kept out — record which the owner chose.

**Never apply a production `noindex` by accident.** Environment-specific protection must key on the
host (or the environment's own build setting), so production can't inherit it. A host-based rule
should make an unknown host non-indexable by default and require production hosts to be opted in.

**Production indexability is always verified on production itself** — never inferred from staging
being right. The classic failure is: staging `noindex`, production accidentally still `noindex`.
`/BWESEO`'s live check reads production's home page and robots.txt every run; `/BWESEOPublish`
reads the page itself. Either finding is a **CRITICAL SEO ERROR** and outranks all page work.

## Canonicals, sitemaps, links, schema, social metadata

| Check | Production rule | Severity |
|---|---|---|
| Canonical | Resolves to the intended production URL. A production canonical on a staging / preview / local host | **CRITICAL** |
| Staging canonical | Must never make staging the preferred URL. Best: points to the production URL. A self-canonical built from the request host is acceptable only if it can't reach production — production's canonical is re-checked after the deploy | Warning |
| Sitemap | Production URLs only, HTTPS, the production host, intended indexable pages. Any staging / preview / localhost URL | **CRITICAL** |
| Staging sitemap | A test artifact. Never submitted anywhere | — |
| Internal links | Production pages link to production pages. A link to staging, preview, localhost or a temporary development domain | Error (unless a verified, intentional reason is recorded) |
| Structured data | `url`, `@id`, `sameAs`, `logo`, `image`, `offers`, breadcrumbs… contain no staging / preview / localhost URLs | Error |
| Social metadata | `og:url`, `og:image`, `twitter:image` and every other absolute metadata URL are production | Error |
| Anything else | No staging hostnames anywhere in the production HTML (the contamination scan) | Error |

`tools/seo-state-core.mjs` → `findEnvironmentLeaks(text, config)` does the scanning for every one of
these; `/BWESEOPublish` runs it on production output.

## The page lifecycle with staging

```
CREATE → SEO QA → DEPLOY TO STAGING → STAGING REVIEW → OWNER'S STAGING APPROVAL
→ (owner's go) DEPLOY TO PRODUCTION → POST-PUBLICATION CHECK (production) → GOOGLE → MONITOR → IMPROVE
```

1. **SEO QA** (`/BWESEOQA <id>`) passes locally.
2. **Deploy to staging** through the project's staging workflow (`workflows.deployStaging` /
   `environments.staging.deploy`). Follow the project's standing rule for staging deploys; when
   there isn't one, ask first.
3. **Staging review** (`/BWESEOQA <id> staging`, which runs
   `seo/tools/post-publish-check.mjs --id <id> --env staging`): page function, SEO, environment and
   content checks with read-only requests; visual checks listed for the owner (see
   `qa-checklists.md` → Staging review). Record `staging.review`.
4. **STAGING REVIEW PASSED → stop.** The owner looks at the page on staging (desktop and mobile)
   and approves it. Record `staging.approval` only from the owner's own words.
   **PRODUCTION DEPLOYMENT REQUIRES YOUR APPROVAL** — a staging approval is not permission to deploy
   unless the project's own workflow explicitly says so.
5. **Deploy to production** only on the owner's explicit go.
6. **`/BWESEOPublish <id>`** verifies it on production from scratch. **Staging QA never replaces
   production verification.** Only after it passes may Google be asked to look at the page.

A project with **no staging** (`status: "not-configured"`) goes from SEO QA straight to the owner's
production approval, and `/BWESEO` says "STAGING ENVIRONMENT: NOT CONFIGURED".

## Preventing false state

- Staging 200 / production 404 → **production: NOT DEPLOYED**. Staging never counts as published.
- The inventory says published but only staging has the page → **PUBLISHED STATUS CONFLICT —
  PRODUCTION NOT VERIFIED.**
- Staging's sitemap lists the page, production's doesn't → production sitemap: MISSING.
- Staging QA passed, production content differs → production needs its own verification (the
  post-publication check reads production's HTML, never staging's).
- A later edit to the page (its source hash changes) invalidates QA, the staging review and the
  staging approval — the page goes back through them.

## Where environment state lives

On the inventory page entry, under `staging` (only what can't be seen live):

| Field | Meaning | Written by |
|---|---|---|
| `staging.deployedOn` | This version was deployed to staging (only needed when staging can't be checked live) | The skill that deployed it |
| `staging.review: { result, date, sourceHash, url, notes }` | Claude's staging review | `/BWESEOQA <id> staging` |
| `staging.approval: { approvedOn, source, sourceHash }` | The owner approved the page on staging | Any skill, only from the owner's words (`source: "owner:<date> chat"`) |

Production deployment is **not** stored: a live GET of the production URL containing the page's
`verifyText` proves it. `postPublication` (written by `/BWESEOPublish`, production only) records the
production verification; indexing status stays under `postPublication.searchConsole`. Site-wide
environment findings (e.g. staging not hidden) are `issues[]` with `area: "environment"`.

## Setup (`/BWESEOSetup`)

Determine, and report:

```
Production URL ........ <verified>
Staging URL ........... <verified>  |  STAGING ENVIRONMENT: NOT CONFIGURED
Preview behavior ...... <verified pattern>  |  not configured
Deployment architecture <detected: hosting, deploy commands>
Staging protection .... <measured: strong / weak / none>
```

Sources: the repo's deploy configuration (hosting config files, deploy scripts, CI), the site's own
host rules (robots route, server headers), and read-only requests to each host. If staging exists
it joins the workflow automatically; if it doesn't, record `not-configured` — never invent one.
