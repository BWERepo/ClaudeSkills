# Baseline audit (`/BWESEOAudit`) → `docs/seo/SEO-BASELINE.md`

A baseline is a dated snapshot of the site as it is, so later work can be measured against it.
It is read-only: the audit never changes the site.

## Procedure

1. Project guard. Read `seo/seo-config.json` and the adapter it names
   (`adapters/<adapter>.md`) — the adapter says where routes, metadata, sitemap,
   robots and schema live in this stack.
2. **Architecture**: framework, rendering (SSR / static / SPA — can a crawler see the content
   without JavaScript?), hosting, environments (is staging blocked from indexing?), deploy flow.
3. **Inventory**: every public URL → `seo/content-inventory.json` (status `published`). Mark
   utility and noindex pages too, so nothing is "unknown".
4. **Per page** (use `qa-checklists.md` → On-page checks): title, meta description, canonical,
   robots meta, H1, heading outline, OG/Twitter tags, schema types, images + alt, internal links
   in/out, CTA, word count of real content, thin/duplicate risk.
5. **Site-wide**: sitemap (all indexable pages, nothing private), robots.txt (per-agent groups!),
   404 status code, redirects (www/apex, trailing slash — 301 vs 307), HTTPS, structured data
   consistency, analytics + consent, Search Console verification, performance risks (render-
   blocking resources, hidden-until-hydration content, image weight), accessibility basics.
6. **Conversion**: every conversion mechanism, what happens on submit, whether the landing page /
   source of a lead is recorded (needed to attribute organic leads).
7. **Trust (E-E-A-T)**: are testimonials, case studies, demo/sample work and claims clearly
   labeled and true? Anything that makes the real business look fictional or unverifiable is a
   Critical finding.
8. **Local signals** (only if `locationDependence` is local/regional/multi-location): NAP
   consistency, address type, Google Business Profile status (ask), location pages.
9. Classify every finding **Critical / High / Medium / Low**:
   - Critical — blocks indexing, misleads users, or undermines trust site-wide.
   - High — direct ranking/conversion damage on important pages (duplicate titles on money
     pages, crawler rules broken, mislabeled proof).
   - Medium — meaningful but contained (missing OG, broken internal anchors, slow LCP).
   - Low — hygiene.
10. Strengths: record what already works so it is not "fixed" away.

## SEO-BASELINE.md sections (see `templates/docs/README.md`)

Date and version audited · architecture · page inventory table · metadata table · sitemap /
robots / canonical / redirects · structured data · analytics & Search Console · conversion
paths · trust & claims · local · performance & accessibility · strengths · findings by severity
(with file:line evidence) · recommended fix order.

## Rules

- Cite evidence (file:line, URL, or query) for every finding.
- Findings are not fixes. List them; fix only what the user approves, through the normal workflow.
- Re-run the baseline after major changes; keep the old one's date in the doc history section.
