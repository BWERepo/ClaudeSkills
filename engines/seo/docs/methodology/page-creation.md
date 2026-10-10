# Creating ONE approved page (`/BWESEOCreatePage`)

**Hard gate:** the target page must exist in `seo/content-inventory.json` with status `approved`
(set only after the user approved that specific page in chat). If not, stop and ask. One page
per run unless the user explicitly asks for more.

## Steps

1. **Recheck conflicts** — re-run `cannibalization.md` against the current source; things may
   have changed since the roadmap.
2. **Research intent** — if web search is available, a quick SERP look (`competitor-research.md`)
   to confirm the page type and questions searchers expect. No copying.
3. **Outline** — H1, section H2s, FAQ candidates, CTA placements, internal links in/out, schema
   types. Share the outline with the user if the page is sensitive (pricing, legal claims).
4. **Verify facts** — build the claims ledger (below). Anything not verified → ask, or cut.
5. **Write original content** per `content-standards.md` and the industry guide.
6. **Implement using the existing design** — follow the adapter: reuse the site's page shell,
   components, typography and CTA components. No new framework, dependency or design system.
7. **Metadata** — unique title, description, canonical, OG/Twitter, robots (indexable).
8. **Structured data** — only types supported by on-page facts (`structured-data.md`); reuse the
   project's schema helpers.
9. **Internal links** — add the planned links TO the page from its parent/siblings and FROM the
   page (`internal-linking.md`). Never leave it orphaned.
10. **Conversion CTA** — the profile's primary conversion, phrased naturally for this page.
11. **Sitemap / indexes** — add to the project's public-page registry / sitemap / IndexNow list
    per the adapter.
12. **Inventory** — update the entry: status `review`, title, created, lastReviewed,
    relatedPages, cta, `claims` (ledger ids).
13. **Build and tests** — the project's build + test commands from `seo-config.json`.
14. **SEO QA** — run `/BWESEOQA` on the page; fix failures.
15. **Change report** — files changed, what the page targets, claims ledger, QA result, what the
    user must verify, and the deploy command they can approve. Do not deploy unless told to.
16. **After the (separately approved) deploy** — run `/BWESEOPublish` (`post-publication.md`).
    The page is not `published`, and must not be called indexable or "ready for Google", until
    that check has verified it live on production. Set `verifyText` and `linksFrom` on the
    inventory entry now so the check knows what to look for.

## Claims ledger

A table in the change report (and `claims` in the inventory entry):

| Claim on page | Profile fact / claim id | Status |
|---|---|---|
| "Plans start at $X" | offerings.services[starter].price | verified 2026-09-29 |

Any claim without a verified source fails QA. Industry-general statements ("most homeowners
compare three quotes") are allowed only as clearly general, unsourced-number-free statements.

## Page structure menu (use what the intent needs — don't force all)

Strong H1 · concise opening that answers the query · the customer's problem · the service /
solution · benefits in the customer's terms · process · what's included / not included ·
pricing (verified only) · proof (real work, labeled demos) · FAQs (real questions) · related
services · related resources · CTA.
