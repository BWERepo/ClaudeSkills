# Industry guide: Restaurant / food service

## Typical customer situations & intents
- **Immediate**: "<cuisine> near me", "restaurants open now <town>", "takeout/delivery".
- **Planned**: reservations, private events, catering, brunch/specials.
- **Menu**: menu, dietary options (gluten-free, vegan — verified), prices.

## What the customer needs to see
Menu (as HTML text, not only a PDF/image), hours (holiday hours), location/parking, reservation or
ordering link, dietary info, photos of real dishes, events/catering details.

## Typical structure
```
Home (cuisine, location, hours, reserve/order)
 ├─ Menu (HTML)            ├─ Catering / private events (if offered)
 ├─ Reservations / order online ├─ Events / specials (kept current)
 └─ About / story (verified)
```

## Must be verified
Hours, menu items and prices, dietary claims, delivery partners, catering capacity, awards.

## Traps
Menu only as an image/PDF; stale specials and events; invented "best in town" awards.

## Schema
Restaurant (with servesCuisine, openingHours, acceptsReservations, menu URL), Event for real
events, BreadcrumbList.
