# Adapter: Astro

| Concern | Where / how |
|---|---|
| Routes | `src/pages/*.astro` / `.md(x)`; content collections in `src/content/` |
| Metadata | A shared `<BaseHead>`/layout component receiving title/description/canonical props |
| Sitemap | `@astrojs/sitemap` if already installed (configure `site` in `astro.config`) |
| robots | `public/robots.txt` or an endpoint |
| JSON-LD | Inline script in the layout/page (`set:html={JSON.stringify(...)}`) |
| Rendering | Static by default — crawlable |
| 404 | `src/pages/404.astro` |

## Adding a page
Use the existing layout, pass head props, add the page (or a content-collection entry), link from
parent pages, `astro build`.
