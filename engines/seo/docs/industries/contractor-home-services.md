# Industry guide: Contractors & home services (plumbing, electrical, roofing, landscaping, cleaning, pest control, painting, flooring, garage doors, remodeling…)

## Typical customer situations & intents
- **Urgent** (plumbing leaks, no power, roof leak, pests) — tap-to-call, availability.
- **Planned projects** (remodel, roof replacement, landscaping install) — estimates, portfolio,
  process, timeline, financing (verified).
- **Recurring** (lawn care, cleaning, pest plans) — plans and pricing model.
- **Local**: "<trade> near me", "<trade> <town>".
- **Cost**: "<project> cost <region>" — only with owner-approved ranges.

## What the customer needs to see
Trade + service area + phone above the fold, licenses/insurance/bonding (verified), real project
photos (stock photos hurt trust), process, estimate policy (free? — verified), warranties,
reviews (link out).

## Typical structure
```
<Trade> services (pillar)
 ├─ One page per major service line the business actually sells (not per sub-task)
 ├─ Estimates / pricing model
 ├─ Project gallery (real work)
 └─ Service area — one honest page, not one per town
```

## Must be verified
Emergency service, free estimates, licenses/insurance, warranties, financing, brands, service
area limits, commercial vs. residential.

## Traps
Town-swap pages; stock photos passed off as projects; "licensed & insured" without verification;
listing every sub-task as its own thin page.

## Schema
The specific LocalBusiness subtype (Plumber, Electrician, RoofingContractor,
HomeAndConstructionBusiness…), Service, BreadcrumbList.
