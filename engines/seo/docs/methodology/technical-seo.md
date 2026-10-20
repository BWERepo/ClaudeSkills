# Technical SEO (`/BWESEOTechnical`)

Do not sacrifice stability for SEO. Every check below is read-only; fixes need approval and go
through the project's normal change + test + deploy workflow.

## Checklist

**Crawl & index**
- robots.txt: one `User-agent: *` group with the Disallows; any agent-specific group (Bingbot,
  Yandex…) must repeat every Disallow, because a crawler obeys only its most specific group.
- Don't both Disallow and `noindex` a URL that is linked publicly — a blocked crawler can't see
  the noindex and may index the bare URL. Prefer `noindex` (crawlable) for linked utility pages.
- Staging / preview hosts are never for indexing (`environments.md`): measure the protection —
  strong = `X-Robots-Tag: noindex` on every response, a noindex meta, or a sign-in; weak =
  robots.txt `Disallow: /` only. Keeping `Disallow: /` next to the noindex header stops crawlers
  that ignore noindex, at the cost of Google not seeing it — record the owner's choice in
  `environments.staging.indexProtection`. The rule must key on the host (or the environment's own
  setting) so production can never inherit it; findings go in `issues[]` with `area: "environment"`.
- Production is indexable: the home page and each public page carry no `noindex` (meta, googlebot,
  `X-Robots-Tag`) and robots.txt doesn't block `/` for `*` — checked on production itself.
- Sitemap: lists every indexable canonical URL, nothing noindex/private; valid XML; `lastmod`
  only when it is real; referenced from robots.txt; production URLs only (no staging, preview or
  localhost URLs — critical).
- Canonical on every indexable page, absolute, pointing at itself (or the true original) on the
  production host. A production canonical to a staging/preview/local URL is critical.
- Social tags: `og:url` is the same page as the canonical on every page (never a site-wide default that a page forgot to
  override); declared `og:image` dimensions equal the real image; the root layout sets no page-specific value.
- Rendering: the H1 and hero are visible in the server HTML (no `opacity:0` until hydration); every public sub-page has the shared
  navigation and footer; footer/navigation section links use `/#anchor` on sub-pages. (`seo/tools/seo-page-checks.mjs`.)
- Environment leakage: no staging, preview, localhost or development URLs in production links,
  structured data, `og:`/`twitter:` metadata or anywhere else in the HTML
  (`findEnvironmentLeaks` in `tools/seo-state-core.mjs`).
- 404s return status 404 (and get their own title + noindex). Maintenance screens return 503 +
  `Retry-After`, never 200.
- Redirects: www↔apex and http→https are 301 (or 308) and reach the canonical URL in ONE hop;
  trailing-slash and uppercase variants of a page redirect permanently (a 307 tells Google to keep
  both URLs). robots.txt on every production host is the canonical file or a redirect to it — a CDN
  can answer robots.txt on a second host before the site's own redirect runs, and can prepend its
  own "managed" rules; both are findings to show the owner.
- Whole-site sweep: `node seo/tools/seo-site-checks.mjs` checks all of the redirect and robots
  rules above plus every sitemap URL (200, no redirect, indexable, self-canonical, real past
  `lastmod`), linked pages that are both Disallowed and noindex, internal links to the key (P1)
  pages, preloaded/oversized images and noindex on demo hosts. It is read-only, and a host it
  cannot reach is "skip" — never evidence of an outage (a sandbox, firewall or a Worker fetching
  its own zone can all fail where the public site is fine).
- No duplicate routes serving the same content under two URLs without a canonical.

**Rendering**
- Main content present in the server HTML (view-source test). Client-only rendering of primary
  content is a High finding.
- Content not hidden with `opacity:0` / off-screen until hydration (hurts LCP; can look like
  hidden text).

**Metadata**
- Unique `<title>` per indexable page (≈ 50–60 chars), unique useful meta description (≈ 140–160).
- OG + Twitter title/description/url/image per page; the `og:image` dimensions tags must match the
  real file; a page-specific image when one exists.
- One verification tag per property (duplicate `name=` metas may be collapsed by the framework).

**Structure**
- One H1 per page; logical H2/H3 outline; semantic landmarks (header/nav/main/footer).
- Internal links resolve on every page they appear (shared footers with `#anchors` break on
  sub-pages — use `/#anchor`).

**Performance** (field data if available, else lab)
- LCP element identified; render-blocking fonts/CSS; image formats/sizes/`width`+`height`;
  caching headers for HTML and static assets; third-party scripts (tag managers) load cost.

**Forms & CTAs**
- Primary conversion works; spam protection doesn't block real users; success state is clear;
  the lead records its landing page/source if possible.

**Accessibility (SEO-relevant)**
- Alt text on meaningful images, empty alt on decorative ones; link text descriptive; color
  contrast; respects reduced motion.

## Output

Findings table (severity, check, evidence, recommended fix, effort S/M/L) appended to the
baseline's findings section, plus suggested regression tests (e.g. robots groups, unique titles,
sitemap coverage) so fixed issues stay fixed.
