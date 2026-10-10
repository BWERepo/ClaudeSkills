# Industry guide: Auto repair / automotive service

## Typical customer situations & intents
- **Urgent**: "check engine light", "car won't start", "brake noise" + "near me".
- **Service**: brakes, diagnostics, oil change/maintenance, transmission, AC, tires, inspections
  (only those offered), specific vehicle types/makes (verified — e.g. diesel, European, classic).
- **Estimates / cost**: "brake job cost", "diagnostic fee" — only owner-approved numbers.

## What the customer needs to see
Services and vehicle types, appointment/drop-off process, estimate policy, warranty on work
(verified), certifications (e.g. ASE — verified), hours, location, shuttle/loaner (verified).

## Typical structure
```
Auto repair services
 ├─ Diagnostics ├─ Brakes ├─ Maintenance ├─ <other offered services>
 ├─ Vehicles we service (makes/types — verified)
 └─ Estimates & appointments
```

## Must be verified
Certifications, warranty terms, makes serviced, towing, loaners, pricing.

## Traps
Generic symptom articles unrelated to services offered; unverified certification badges.

## Schema
AutoRepair (LocalBusiness subtype), Service, BreadcrumbList.
