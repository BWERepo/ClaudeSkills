# Internal linking (`/BWESEOInternalLinks`) → `docs/seo/INTERNAL-LINKING.md`

## Analysis

1. Build the link graph from source (nav, footer, body links) for every indexable page:
   links in, links out, anchor texts.
2. Flag: orphan pages (no body/nav links in), pages reachable only via sitemap, broken links,
   anchors that only work on one page (`#section` in a shared footer), pillars that don't link to
   their clusters or vice versa, repetitive exact-match anchors, link-stuffed blocks.
3. Check the conversion path: every commercial page links to the primary conversion.

## Rules for every new/improved page

Answer in the page map and in `INTERNAL-LINKING.md`:
- What existing pages should link TO this page? (at least the parent/pillar + 1–3 relevant
  siblings, placed where a reader would want it — in body copy, not only the footer)
- What pages should this page link TO? (parent, 2–5 genuinely related pages, the conversion)
- What is its parent/pillar?
- Could it become orphaned? (If only the sitemap links to it — yes; fix before publishing.)

Shared navigation: every public page gets the site header and footer from one shared component, so a new page is linked to the rest
of the site automatically. A link to a homepage section from any other page is `/#section`, not `#section` (which goes nowhere on a sub-page).
`seo-page-checks.mjs` reports a sub-page with no navigation/footer and dead anchors.

Anchors: natural, descriptive, varied ("see what a redesign involves", "our website redesign
service"); avoid the same exact-match keyword anchor everywhere; avoid "click here".
Don't overload: a link should help the reader take the next step.

## Output

Link matrix (page → links in/out), issues list with fixes, and the planned link additions for
each roadmap page.
