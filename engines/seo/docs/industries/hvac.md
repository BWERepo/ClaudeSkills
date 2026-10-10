# Industry guide: HVAC (heating, ventilation, air conditioning)

## Typical customer situations & intents
- **Urgent**: "AC not cooling", "furnace not working", "AC repair near me", "emergency HVAC"
  (the latter only if emergency service is VERIFIED).
- **Planned**: AC/heat pump/furnace installation or replacement, maintenance plans, duct work,
  indoor air quality, commercial HVAC (only if offered).
- **Comparison**: repair vs. replace, heat pump vs. furnace, brands (only brands they install).
- **Cost**: "AC replacement cost <region>", "heat pump installation cost" — only with the owner's
  approval to discuss price ranges.
- **Seasonal**: pre-summer AC tune-ups, pre-winter furnace checks.

## What the customer needs to see
Service area (towns), response/availability (verified), licensing and insurance, brands serviced/
installed, financing (verified), maintenance plan details, how to book, real reviews (link to
Google, don't copy), technicians (with permission).

## Typical structure
```
HVAC services
 ├─ Air conditioning: AC repair · AC installation/replacement
 ├─ Heating: furnace repair · heating installation · heat pumps
 ├─ Maintenance plans / tune-ups
 ├─ Indoor air quality (if offered)
 └─ Service area page(s) — only with unique local value
```

## Must be verified
Emergency/24-7 service, response times, financing, brands/dealer status (e.g. factory
authorized), licenses (state contractor license numbers), warranties, commercial service,
service-area boundaries, pricing.

## Conversions
Call (tap-to-call first on mobile), schedule service, request estimate, maintenance plan signup.

## Traps
Fake "24/7" claims; city-swap service-area pages; copying manufacturer marketing; seasonal pages
left stale out of season.

## Schema
HVACBusiness (LocalBusiness subtype), Service, BreadcrumbList; Offer only for published prices.
