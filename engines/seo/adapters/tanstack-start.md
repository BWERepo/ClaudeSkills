# Adapter: TanStack Start (React, file-based routes, SSR) on Cloudflare Workers

| Concern | Where / how |
|---|---|
| Routes | `src/routes/*.tsx` (file-based; `[.]` escapes a dot: `robots[.]txt.ts` → `/robots.txt`; `$param` dynamic; `_authenticated/` = layout group) |
| Per-page metadata | The route's `head: () => ({ meta, links, scripts })` option. `meta: [{ title }, { name: "description", content }]`, `links: [{ rel: "canonical", href }]`, `scripts: [{ type: "application/ld+json", children: JSON.stringify(schema) }]` |
| Page metadata builder | Use ONE shared helper (e.g. `buildPageMeta({ path, title, description, image? })` in `src/lib`) that returns `{ meta, links }` — title, description, canonical, `og:url`, `og:title`, `og:description`, `og:type`, `og:image`, Twitter tags — all derived from the page's `path`, and call it from every public route's `head()`. Canonical and `og:url` then come from the same value and cannot drift apart |
| Site-wide defaults | `src/routes/__root.tsx` `head()` — child routes override by `name`/`property`; **the deepest route wins and duplicate `name=` metas collapse to one**, so two verification tags with the same name cannot coexist |
| Root `head()` rules | **Never hard-code a page-specific value in `__root.tsx`.** In particular no `og:url` (and no canonical): a route that doesn't override it would tell Facebook, LinkedIn and Slack that it is the homepage. Put only truly site-wide defaults there (site name, locale, a default share image). Don't declare `og:image:width`/`height`/`alt` at the root either — a route with its own image would inherit dimensions that are wrong for it; declare them next to the image they describe, and make them equal the real pixel size |
| Shared header / footer | One shared header and footer component (in `src/components`, not exported from a route file) used by every public content page. Footer and navigation links to a homepage section must be router links to the home page (`<Link to="/" hash="pricing">` → `/#pricing`); a plain `<a href="#pricing">` only works on the page that has that id and is dead on every other page |
| Above-the-fold rendering | Animation wrappers (fade-in / "reveal" components) render `opacity: 0` in the **server** HTML and only become visible after hydration. Never wrap the H1 or the hero in one (or give the wrapper an "immediate" mode that renders plainly); keep reveal effects for below-the-fold sections, and honor `prefers-reduced-motion` |
| Sitemap | A server route (e.g. `src/routes/sitemap[.]xml.ts`) — find the page registry it reads (e.g. `src/lib/public-pages.ts`) and add new paths there |
| robots.txt | Server route `src/routes/robots[.]txt.ts`; check host-based staging behavior |
| Environment protection | Host-based: a production-host allowlist (e.g. an `isCanonicalHost()` helper) decides robots.txt and, in the Worker entry (`src/server.ts` fetch handler), an `X-Robots-Tag: noindex` header on every non-production response. Keep the rule on the host so production can't inherit it and unknown hosts default to non-indexable |
| JSON-LD helpers | Look for shared builders (`build*Schema`) in `src/lib` before writing new ones |
| Content source | Mix of hard-coded route/lib content and database/admin-editable content (server functions `createServerFn`) — prefer the existing pattern for the section being extended |
| Rendering | SSR by default; `ssr: false` routes are client-only (fine for private pages, never for SEO pages) |
| 404 | `notFoundComponent` on the root; `throw notFound()` in loaders — returns real 404 |
| Redirects | Server entry (e.g. `src/server.ts`) and `redirect()` in loaders (default 307 — pass `statusCode: 301` for permanent) |
| Build / test | `npm run build`, `npm test` (vitest), `npx tsc --noEmit` |

## Adding a page
1. Create `src/routes/<slug>.tsx` with `createFileRoute("/<slug>")`, a `loader` if it needs server
   data, and a `head` returning title, description, canonical, OG/Twitter, JSON-LD.
2. Reuse the existing page shell/components (look at the nearest similar page — e.g. a location
   landing page component or case-study page) — don't invent a new layout.
3. Add the path to the public-page registry so sitemap + IndexNow include it; the route tree
   file regenerates on build/dev.
4. Add links from parent/siblings (and the footer/nav if appropriate — use `/#anchor` style).
   Build the `head` with the shared metadata builder, not by hand, and render the shared header and footer.
5. Add/extend tests (unique titles, canonical present, schema shape) next to existing ones.

## Automatic checks for these rules
`seo/tools/seo-page-checks.mjs` (run by `post-publish-check.mjs` on staging and production, or on its own against a saved page
with `node seo/tools/seo-page-checks.mjs --html page.html --url <page URL> --home home.html`) reports: `og:url` differing from the
canonical (so an inherited homepage `og:url` is caught), declared `og:image` dimensions that don't match the image, a server-rendered
H1 hidden by `opacity:0`, a sub-page with no navigation or footer when the home page has them, and navigation/footer `#anchors` with no
target on the page. Uncertain cases are reported as **REVIEW REQUIRED**, never as defects. See `qa-checklists.md`.

## Verifying
`npm run build` then preview, or deploy to staging per the project's workflow;
`curl -s https://<staging>/<slug> | grep -i "<title>\|canonical\|ld+json"`; check status codes;
`curl -sI https://<staging>/<slug> | grep -i x-robots-tag` (should say noindex) and the same on
production (should say nothing). Or `node seo/tools/post-publish-check.mjs --id <id> --env staging`.
