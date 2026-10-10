# Opportunity scoring (P1 / P2 / P3)

No invented precision. Without real keyword data (Search Console, a paid tool the user approved),
never state search volumes, difficulty scores or traffic forecasts. Score qualitatively and say
what evidence each rating rests on.

## Factors (rate each High / Medium / Low, one line of evidence)

| Factor | Question |
|---|---|
| Commercial intent | Is the searcher close to hiring/buying? |
| Business relevance | Does it match a **verified** offering? (No → reject; do not score further.) |
| Conversion potential | Can this visitor reach the primary conversion naturally? Is it a priority/high-value service? |
| Search-intent match | Can one page fully satisfy the intent, in the page type searchers expect (per SERP check)? |
| Existing authority | Does the site already have related pages, links, proof, local presence? |
| Competition / realistic opportunity | Who ranks now (directories, national brands, local firms)? Can this site realistically compete in 3–12 months? |
| Local relevance | Does geography matter, and is the business genuinely there? |
| Content gap | Is it missing from the site, or thin? |
| Unique value | Can this business say something competitors can't (real process, real proof, real prices, real expertise)? |
| Cannibalization risk | Would it compete with an existing page? (High risk → improve/merge instead) |

## Classification

- **P1** — verified offering + High commercial intent or conversion potential + clear gap or
  weak existing page + real unique value + Low cannibalization risk (or it IS the improvement of
  the existing page). Do these first.
- **P2** — useful and relevant, but either weaker intent, harder competition, or dependent on a
  P1 page existing first (supporting content).
- **P3** — long-term, speculative, or blocked by missing facts/proof. Keep in the roadmap with
  the blocker named.
- **Reject** — not a verified offering, `doNotPromote`, no plausible customer path, or duplicates
  an existing page. Record the reason so it isn't re-proposed.

## Output

A table: opportunity · decision (create / improve-existing / merge / reject) · priority · the ten
ratings (compact H/M/L string) · evidence summary · blockers.
