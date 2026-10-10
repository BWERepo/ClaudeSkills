# Discovery & onboarding (Layer 2 — the business profile)

Goal: a business profile made only of facts that can be traced to a source. Everything the
engine later writes about the business is checked against this file.

## Sources, in order of trust

1. The owner, in writing (chat message, email, signed questionnaire).
2. The agency's onboarding questionnaire answers (see `questionnaire-mapping.md`).
3. The business's own live, verified website and admin-managed data (e.g. a settings table).
4. Official registries (state business registry, license lookup) — cite the URL.
5. Anything else (directories, reviews sites, social bios) is **unverified** until the owner
   confirms it.

Search results, keyword tools and competitor sites are **never** sources for facts about this
business.

## The Fact object

Every factual field in `business-profile.json` is a Fact:

```json
{ "value": "...", "status": "verified", "source": "questionnaire:business_info_service_area",
  "verifiedOn": "2026-09-29", "public": true, "notes": "" }
```

- `status`: `verified` (has a source and date), `unverified` (seen somewhere, not confirmed),
  `needs-input` (unknown — ask), `not-applicable`.
- `source`: a short citation — `owner:2026-09-29 chat`, `questionnaire:<answer_key>`,
  `db:business_settings.phone`, `site:/about`, `repo:src/lib/x.ts:120`, `url:https://…`.
- `public`: false for facts the business does not want published (e.g. a home address used only
  for records). Non-public facts are never written into pages or schema.

## What to collect (profile sections)

| Section | Fields |
|---|---|
| identity | businessName, legalName/dba, website, industry, businessType, description, foundedYear, ownerName (+ whether it may be published) |
| markets | locationDependence (`local` / `regional` / `multi-location` / `non-local`), primaryLocation, serviceAreas, locations[] (type: storefront / office / service-area-only / mailing; public?) |
| offerings | services[], products[] — each with description, price (+ "from"/fixed/quote), whether it is a priority or high-value service |
| customers | primaryCustomers[], industriesServed[], customer problems the business solves |
| positioning | differentiators[], brandVoice, primaryConversion, secondaryConversions[] |
| contact | phone, email, businessHours, socialProfiles[] |
| trust | licenses, certifications, memberships, awards, testimonials, reviews, caseStudies (each with permission to publish) |
| competitors | name + URL + source (owner-named or research-found; research-found stays labeled as such) |
| claims | verified[] (reusable claim sentences with ids), prohibited[] (claims never to make, with reason) |
| doNotPromote | services/topics/lead types the business does not want (from `_unwanted_leads` etc.) |
| openQuestions | what is missing and which planned pages it blocks |

## Procedure (`/BWESEOSetup`)

1. Project guard (see engine README). Create `seo/` and `docs/seo/` from `templates/` if absent.
2. Gather sources: questionnaire export in `seo/sources/`, the live site, admin data (read-only),
   owner answers in chat.
3. Fill each Fact with value + source + status. When two sources disagree, record both in
   `notes`, set `unverified`, and add an open question.
4. Record prohibited claims explicitly: anything the business cannot prove (e.g. "24/7 service"
   if unverified), anything regulated (medical/legal/financial outcomes), and ranking promises.
5. List every `needs-input` item in `openQuestions`, each tied to what it blocks.
6. Record the **environments** (`environments.md` → Setup): production URL and hosts, staging
   (verified URL + hosts, or `status: "not-configured"` — never invented), preview patterns (only
   if the project really uses them), how to run it locally, and each environment's deploy
   workflow. Measure staging's protection from search engines with read-only requests and report
   it; if it is weak or missing, add an `issues[]` entry with `area: "environment"` for the owner
   to decide.
7. Run the validator. Present the open questions to the user; do not guess answers.

## Re-verification

Prices, hours, services and staff change. `lastReviewed` on the profile, and `verifiedOn` on each
fact, drive the refresh cycle (`content-refresh.md`): facts older than 180 days are re-checked
before they are used on a new page.
