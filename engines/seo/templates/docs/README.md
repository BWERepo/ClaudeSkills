# Doc templates

`/BWESEOSetup` creates these in the project's docs location (default `docs/seo/`). Each file
starts with this header block, then the sections listed.

```
# <Doc title> — <Business name>
Last updated: YYYY-MM-DD · Engine 1.0.0 · Owner: <who approves changes>
```

| File | Sections | Methodology |
|---|---|---|
| SEO-BASELINE.md | Architecture · Page inventory · Metadata · Sitemap/robots/canonical/redirects · Structured data · Analytics & Search Console · Conversion paths · Trust & claims · Local · Performance & accessibility · Strengths · Findings (Critical/High/Medium/Low, with evidence) · Recommended fix order · History | baseline-audit, technical-seo |
| SEO-STRATEGY.md | Goal & primary conversion · Customer & intent model for this business · Positioning (verified only) · Competitive landscape · Content architecture (pillars/clusters) · Existing pages to improve · What we will NOT do · Open questions | intent-model, competitor-research |
| SEO-PAGE-MAP.md | One card per page (fields in page-map-and-roadmap.md) | page-map-and-roadmap, cannibalization |
| CONTENT-ROADMAP.md | Priority-ordered opportunities with the five questions · P1 report · Rejected/parked with reasons · Dependencies | page-map-and-roadmap, opportunity-scoring |
| INTERNAL-LINKING.md | Current link graph · Issues · Rules · Planned links per roadmap page | internal-linking |
| SEO-MEASUREMENT.md | Primary metric · Baseline · Data sources & access · Attribution gaps · Cadence · Report template | measurement-reporting, search-console |
| SEO-OPERATIONS.md | Only in the agency's own repo: the operating manual for the engine | README |
| reports/ | Monthly reports, Search Console analyses, QA reports, post-publication reports (`publish-<id>-<date>.md` + `.json`), 7/30/90-day page reviews | measurement-reporting, qa-checklists, post-publication, search-console |
