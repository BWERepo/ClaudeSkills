# Research methodology

## Stage A — industry analysis

Answer in short bullets, from the brief and general knowledge (label assumptions as assumptions):

- **Industry characteristics:** what is sold or offered, price tier, how buying happens (checkout, quote, booking, sign-up, donation, calculation).
- **Audience expectations:** what signals quality and trust to these people.
- **Customer journeys:** the 2-4 journeys that matter (for example browse → shortlist → inquire; find answer → act).
- **Conversion actions:** primary and secondary.
- **Visual positioning:** where the brand should sit (accessible ↔ exclusive, warm ↔ technical, editorial ↔ utilitarian).
- **Functional requirements:** catalogs, filters, wishlists, forms, calculators, maps, booking, accounts.
- **Adjacent industries:** 3-5 with a reason each. Examples:

| Project | Useful adjacent sources |
|---|---|
| Event or tabletop rentals | Luxury home goods, premium retail, wedding services, furniture, hospitality |
| Dental or medical practice | Wellness brands, boutique fitness, hospitality booking, insurance comparison |
| Consumer calculator / utility | Fintech, tax and budgeting tools, weather and travel utilities, developer tools |
| Home services (HVAC, plumbing) | Insurance quoting, on-demand services, local delivery |
| Nonprofit | Crowdfunding, membership products, editorial publishers |
| SaaS / dashboard | Analytics tools, project management, banking dashboards |

## Query plan

Before searching, list 10-20 planned queries in `brief.md` as a table: function (homepage, navigation, catalog, detail, forms, journey, mobile, conversion), tool (sections/screens/flows), query, industry (core or adjacent). Cover every function the project needs; skip functions it does not have (a calculator site has no product detail page).

## Stage B — broad discovery

- Target 20-30 candidates; minimum 12 before presenting. Fewer relevant results: say so.
- Keep diversity: no more than 3 candidates from one app, no more than 6 for one function.
- Discard near-duplicates when found (same app and same pattern, or the same image).
- Record only what tools returned. Unknown fields stay empty, not guessed.

## Stage C — detailed evaluation

Score with `evaluation-rubric.md`. Score against **this brief**: an excellent design for the wrong audience scores low on relevance.

## Stage D — shortlist

`score.mjs shortlist` picks the top 5-8 after diversity rules and reports functions with no coverage. Fill a gap with the best remaining candidate for that function, even if it ranks lower, and say why. Do not shortlist eight near-identical designs.

## Mode notes

- **audit:** start from the existing site. List its pages and, for each, the weakest pattern (with evidence: a screenshot the user or browser tools supplied, or the code). Research replacements only for those patterns.
- **refresh:** re-run the stored query plan from the last approved run; keep references that still exist and still rank; replace expired `image_url`s; report what changed.
- **compare:** score the supplied designs (prototype URLs, screenshots, directions) on the same rubric and present them side by side. If the user wants Mobbin evidence, find 1-2 references per contested pattern.
