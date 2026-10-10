# Questionnaire → business profile mapping

The agency's onboarding questionnaire (New Website / Website Makeover workflows) already asks
most of what SEO needs. Use its answers as a primary source (status `verified`, source
`questionnaire:<answer_key>`), because the owner typed them.

## Getting the answers

Preferred: the admin "Questionnaire results" export for that customer, saved into the customer
repo at `seo/sources/questionnaire-<date>.(csv|pdf|txt)`. Do not query another customer's data,
and do not copy answers into any other project.

## Core mapping (answer keys are stable; labels may be reworded by the admin)

| Answer key | Profile field |
|---|---|
| `business_name`, `dba` | identity.businessName, identity.dba |
| `industry` (+ project Industry tag) | identity.industry → pick `docs/industries/<x>.md` |
| `address`, `city`, `state`, `zip` | markets.locations[] — ask whether the address is public (storefront/office) or private |
| `phone`, `email`, `preferred_contact` | contact.phone, contact.email, positioning.secondaryConversions hint |
| `hours` | contact.businessHours |
| `business_contact` | identity.ownerName (public = needs-input) |
| `business_info_service_area` | markets.serviceAreas, markets.locationDependence |
| `business_info_years_in_business` | identity.foundedYear (derive only if the answer is a year; otherwise keep text) |
| `business_info_description` | identity.description |
| `business_info_differentiator`, `final_thoughts_why_choose_you` | positioning.differentiators (each must still be provable before it becomes a public claim) |
| `domain_email_current_website_url` | identity.website (Makeover: the site being replaced — audit it) |
| `website_planning_primary_goals`, `website_planning_goal`, `final_thoughts_three_goals` | positioning.primaryConversion / secondaryConversions |
| `website_planning_primary_cta`, `_other` | positioning.primaryConversion |
| `website_planning_audience` | customers.primaryCustomers |
| `website_planning_competitors` | competitors[] (source = owner) |
| `final_thoughts_must_not_have` | claims.prohibited / doNotPromote |
| `content_services`, `content_products`, `content_about`, `content_faq` | offerings.*, trust, FAQ candidates |
| `features` | conversion mechanisms available (booking, quote form, online store…) |

## Industry sections (lead-generation questions)

Every generated industry section ends with three questions keyed by the industry slug:

| Answer key pattern | Profile field | Why it matters for SEO |
|---|---|---|
| `<slug>_priority_*` | offerings.priorityServices | What the owner most wants more customers for → first candidates for P1 pages |
| `<slug>_valuable_work` | offerings.highValueServices | Most profitable work → weight "conversion potential" up |
| `<slug>_unwanted_leads` | doNotPromote | Work they do NOT want → never target it, even if searched a lot |

Other industry answers (services offered, emergency service yes/no, insurance accepted, brands,
licenses, service area) become offerings/trust facts. A yes/no like `hvac_emergency_service = yes`
is what verifies "emergency service" — a search volume never does.

## Gaps the questionnaire does not cover

Pricing the owner wants published, review/testimonial permission, awards, social profile URLs,
case-study permission, and whether an address is public. Add these to `openQuestions`.
