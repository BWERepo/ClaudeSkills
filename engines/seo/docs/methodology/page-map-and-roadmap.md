# Page map, content roadmap & P1 report (`/BWESEOContentPlan`)

## Pillars and clusters

Group opportunities into industry-appropriate pillars (see `docs/industries/<x>.md` for
typical structures). A pillar is a broad commercial page; clusters are narrower pages that
support it and link back. Existing pages usually become pillars — don't create a pillar that
duplicates the home page.

## SEO-PAGE-MAP.md — one row/card per proposed or improved page

proposed URL · page type · primary intent · primary topic · secondary topics · target customer ·
geographic relevance · funnel stage (awareness / consideration / decision) · associated
verified service/product · CTA · parent/pillar · pages that should link TO it · pages it links
TO · existing competing page · cannibalization risk + decision · priority · rationale · SERP
notes · facts it depends on (profile fact paths) · blockers · intended navigation placement
(primary / service / resource / footer / contextual-only — confirmed by `/BWESEOPublish`).

Record the planned "pages that should link TO it" as `linksFrom` in the inventory entry — the
post-publication check compares them with the links it finds on the live site.

The map is a strategy document. **Nothing in it gets built without approval.**

## CONTENT-ROADMAP.md

Roughly 10–20 opportunities, fewer if fewer are worth doing. For each, answer in plain words:

1. **Why should this page exist?**
2. **What search intent does it satisfy?**
3. **Who would search for it?**
4. **How could that person become a customer?**
5. **What unique value can this business provide?**

If any answer is weak, remove the page (move it to "Rejected / parked" with the reason).
Order by priority, then by dependency (a cluster page after its pillar).

Also list: existing pages to improve (these often beat new pages), technical fixes that block
SEO value, and facts that must be verified first.

## Inventory update

Every roadmap item gets a `content-inventory.json` entry: status `idea` (listed) or `planned`
(in the current P1 set), with priority, intent, parent, CTA and the cannibalization decision.

## The P1 approval report (then STOP)

For the ~5 strongest P1 opportunities present a table/cards with: page · proposed URL · search
intent · prospective customer · why it should exist · existing page that may conflict ·
conversion path · pages that should link to it · pages it should link to · unique value.

Then **stop and ask which ONE page to create first**. Do not create pages in this skill.
Approval is recorded by setting that inventory entry's status to `approved` (with
`approvedOn` and `approvedBy: "user"`).
