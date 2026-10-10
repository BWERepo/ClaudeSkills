# Cannibalization protection

Run this **before proposing or creating any page**. Prefer strengthening a useful existing page
over creating a near-duplicate.

## Procedure

1. Search `seo/content-inventory.json` (all statuses, including `idea` and `rejected`) for the
   topic, its synonyms, and the intent.
2. Search the live source too (route files, content data, CMS/admin content) — the inventory can
   be stale. Include page titles, H1s, meta descriptions, and FAQ questions.
3. For every overlapping page answer:
   - Does this topic already exist? Does an existing page already rank or target it (title/H1)?
   - Could the existing page be improved to cover the intent fully?
   - Would the new page compete for the same queries (same intent + same entity/location)?
   - Could two topics be combined into one stronger resource?
4. Decide one of:
   - **improve-existing** — expand/retitle the existing page (default when intent matches).
   - **create** — intents are genuinely different (e.g. "what does X cost" guide vs. "hire X in
     <city>" service page) and each page links to the other with a clear role.
   - **merge** — two weak pages → one strong page + 301 from the retired URL.
   - **reject** — duplicate with nothing new to add.
5. Record the decision, the competing URL, and the risk (Low / Medium / High) in the page map and
   the inventory entry (`cannibalization` field).

## Common traps

- Home page and a city page with the same title/H1 target → give each a distinct primary target.
- "Service" page and "service cost" page targeting the same head term → split by intent, not by
  keyword.
- One page per city/industry that only swaps the name → doorway risk; reject or make each unique.
- Blog post answering the same question as a service page's FAQ → keep the answer on the service
  page unless the guide adds substantially more.

## With real Search Console evidence (engine 1.10.0)

Before a page exists the check above is judgement. Once a page has impressions, `keyword-performance.md` detects the same problem from data: two or more pages
with meaningful impressions for one query, or Google showing a different page than the registered target. Such a finding is flagged **for review** with its
evidence; it is never assumed harmful, and no URL, canonical or page is changed automatically.
