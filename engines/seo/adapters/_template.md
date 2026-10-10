# Adapter: <stack>

An adapter tells the engine where SEO things live in one kind of website stack, so the strategy
layer never depends on a framework. Record the project-specific answers in
`seo/seo-config.json` → `stack`.

| Concern | Where / how in this stack |
|---|---|
| Route / page list | |
| Per-page title, description, canonical, robots | |
| Site-wide defaults (OG image, verification tags, analytics) | |
| Sitemap | |
| robots.txt | |
| Structured data (JSON-LD) | |
| Content source (files, CMS, database, admin screens) | |
| Rendering (SSR / static / SPA) — can crawlers see content? | |
| 404 handling + status code | |
| Redirects | |
| Images (location, optimization) | |
| Build / test commands | |
| Deploy workflow (staging → production) | |
| Environments: production hosts, staging hosts (custom + platform hostnames), preview pattern | |
| How staging is kept out of search results (X-Robots-Tag, noindex meta, sign-in, robots.txt) — and how production is kept indexable | |

## Adding a page
Step-by-step for this stack: create the route/file, reuse the page shell, set head metadata,
add JSON-LD, register in sitemap, link from parent/siblings.

## Verifying
How to check server HTML, status codes and metadata locally or on staging — including the
staging response's `X-Robots-Tag` header (`curl -sI`) and production's absence of one.
