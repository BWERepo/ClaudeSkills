# Industry guide: Retail / specialty store (e.g. fabric, sewing & vacuum, gifts, boutiques)

## Typical customer situations & intents
- **Product / category**: "<product category> store <town>", "<brand> dealer near me",
  specialty supplies (e.g. quilting fabric, sewing machines).
- **Service add-ons**: repairs, classes, rentals (verified).
- **Local visit**: hours, directions, parking, in-stock questions.
- **Online purchase**: only if the store genuinely sells online (shipping, pickup).

## What the customer needs to see
What they carry (categories, brands — verified authorized-dealer status), whether it's in stock
or orderable, classes/events schedule, hours, location, buy online vs. in store, repair/service
turnaround.

## Typical structure
```
Home (store identity, hours, location)
 ├─ Category pages (only categories with real depth)
 ├─ Brands carried (authorized dealer only if verified)
 ├─ Services: repairs / classes / rentals
 ├─ Events / classes calendar
 └─ Visit us (directions, parking, hours)
```

## Must be verified
Brands and dealer status, class schedule and prices, repair services, online ordering/shipping,
hours, return policy.

## Traps
Thin category pages with no products; copying manufacturer descriptions; stale event pages.

## Schema
Store (or specific subtype), Product/Offer only for real listed products, Event for real classes,
BreadcrumbList.
