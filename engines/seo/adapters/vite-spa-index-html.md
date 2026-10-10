# Adapter: Vite + React single-page app (one `index.html`, no router or a hash router)

| Concern | Where / how |
|---|---|
| Routes | Usually one page with sections (`#anchors`); maybe no router at all |
| Metadata | Static tags in `index.html` `<head>` (title, description, canonical, OG, verification) |
| Sitemap / robots | Static files in `public/` (`public/robots.txt`, `public/sitemap.xml`) |
| JSON-LD | Static `<script type="application/ld+json">` in `index.html` |
| Content source | Often a data file (e.g. `src/data/site.js`) — the natural place business facts live |
| Rendering | Client-rendered: crawlers that don't run JS see only `index.html`. Keep key facts (name, service, area, phone) in the static HTML/metadata; consider prerendering before adding many pages |
| 404 | Host config (static assets fallback) — check that unknown URLs don't all return 200 with the home page |

## SEO limits of this stack
A single SPA page can rank for one primary intent. More pages need either a router + prerendering
(e.g. a prerender step producing real HTML per route) or a stack change — **that is a
recommendation for the user, never done silently**.

## Demo / sample sites
If the site is a demo for a fictional business it must stay `noindex` with a clear label; do not
run the opportunity workflow on fictional business data.

## Verifying
`npm run build` → inspect `dist/index.html` for title/canonical/JSON-LD; `curl` status codes on
the deployed host.
