# Structured data (`/BWESEOSchema`)

Audit what exists first. Add only what the visible page and verified facts support. Validate.

## Audit

For every indexable page: list JSON-LD blocks (types, key properties, where the values come from —
hard-coded vs. data-driven), check for duplicates/conflicts (the same business described twice
with different names/addresses, multiple Organization nodes without `@id` linking), and invalid
JSON. Note anything the page does not visibly support.

## Types and when to use them

| Type | Use when | Watch out |
|---|---|---|
| Organization / LocalBusiness subtype (e.g. ProfessionalService, HVACBusiness, Dentist, AutoRepair, Restaurant, Store) | Always for the business entity (one canonical node, stable `@id`, reused by reference) | Address must be the real public location type; service-area businesses without a public address use `areaServed` and omit street address |
| WebSite | Home page | Only add SearchAction if site search exists |
| Service | Service pages | `provider` → the business `@id`; `areaServed` only where genuinely served |
| Product / Offer | Real products with real prices | Price must match the page and be current |
| BreadcrumbList | Any page below the home page | Must match visible breadcrumbs / hierarchy |
| Article | Guides, case studies | Include `datePublished`/`dateModified`, real author/publisher |
| FAQPage | Only when the page shows those Q&As visibly | Rich results are restricted to certain site types (check current Google guidance); markup is optional, never required |
| Review / AggregateRating | **Only** with real, on-page, first-party-collected reviews and permission | Never for self-serving business reviews shown only in schema; never fabricated |

## Rules

- Never fabricate ratings, reviews, prices, hours, addresses, `sameAs` profiles.
- Emit `openingHours` / `sameAs` only from verified profile facts.
- Don't emit empty structures (e.g. FAQPage with zero questions).
- Validate every changed page: JSON parses; required properties present; values match the page.
  Use Google's Rich Results Test / Schema Markup Validator when the user can run them — record
  the result in the QA report.
