# Industry guide: Dental practice

## Typical customer situations & intents
- **Urgent**: toothache, broken tooth, "emergency dentist" (only if VERIFIED same-day/emergency).
- **Planned**: new-patient exam/cleaning, family dentistry, specific treatments (implants,
  crowns, Invisalign/clear aligners, whitening, veneers) — only treatments actually offered.
- **Insurance / payment**: "dentist that takes <plan>", "dentist without insurance", membership
  plans — only verified plans.
- **Local**: "dentist near <neighborhood>", "family dentist <town>".
- **Anxiety / trust**: sedation options (verified), gentle care, kids' dentistry.

## What the patient needs to see
Treatments offered, accepting new patients, insurance/payment options, providers (names,
credentials — verified), location/parking/hours, how to book, what the first visit is like.

## Typical structure
```
Dental services
 ├─ General & family dentistry ├─ Cosmetic (whitening, veneers)
 ├─ Restorative (crowns, implants) ├─ Orthodontics / aligners (if offered)
 ├─ Emergency dentistry (verified only)
 ├─ New patients (what to expect, forms)  └─ Insurance & payment
```

## Must be verified
Every treatment, emergency availability, insurance plans, membership plan terms, provider
credentials, technology claims, sedation.

## Traps (regulated)
No outcome guarantees ("pain-free", "perfect smile"), no before/after without consent, no
invented provider credentials, no patient testimonials without HIPAA-compliant consent.

## Schema
Dentist (LocalBusiness subtype), Person for providers (verified), Service, BreadcrumbList.
