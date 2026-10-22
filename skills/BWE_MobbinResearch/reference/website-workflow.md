# The BWE website workflow, and where this skill fits

Mobbin decides **what to build**. Claude Code **builds** it. Impeccable **refines** what was built. Keeping the three separate keeps each skill reusable.

| Step | Who | Output |
|---|---|---|
| 1 | **BWE_MobbinResearch** (research) | 12+ (target 20-30) Mobbin references, ranked shortlist, three directions |
| 2 | Owner | Approves a direction (gate) |
| 3 | **BWE_MobbinResearch** (handoff) | `BWE-DESIGN-SPEC.md`, optional `prototype-brief.md` |
| 4 | Claude Code (separate request) | Three homepage concepts, same content, desktop + mobile previews |
| 5 | Owner (optionally `compare` mode) | Chooses the winning homepage |
| 6 | Claude Code | Remaining pages, after the homepage is approved |
| 7 | **Impeccable / BWEImpeccable** | Refines typography, spacing, composition, colour, responsiveness; before/after screenshots and approval per change; repeat per key page |
| 8 | Integrations | Confirm third-party systems (inventory, booking, payments) before connecting live data |
| 9 | Owner / client | Private preview, client approval before full implementation |

## Rules carried into the build

- Give Claude a **research assignment**, not "make it beautiful". If a result shows generic descriptions without real references, ask for the actual Mobbin screens it used.
- Build three homepage concepts first; build no other pages and connect no live data until the homepage is approved.
- Third-party systems stay authoritative. Put a replaceable adapter between the site and the system, use mock data while prototyping, and never invent the vendor's API endpoints, credentials or features. List what needs the vendor's confirmation.
- Design targets: agency-level visual quality, distinctive typography and photography, restrained animation, clear journeys, WCAG 2.1 AA, fast pages with optimised images, no generic AI layouts, no oversized buttons or purposeless empty space.
- SEO: use BWESEO where installed (metadata, canonicals, sitemap, structured data, service-area content, image descriptions, internal links, correct 404s).

## Worked example: premium tabletop event rental website

Illustrative brief only. The names in braces are placeholders; a real run reads them from the project.

**Brief.** A new event rental company in {primary city}, also serving {secondary city}, renting fine china and dinnerware, flatware, glassware and stemware, and tabletop accessories. Audience: engaged couples, wedding planners, event coordinators, venues, corporate event organisers. It should feel like a luxury event company, not a generic e-commerce store. Primary conversion: build a wishlist and request a quote (an inquiry, not a confirmed reservation or checkout).

**Query plan (functions and adjacent industries).**

1. Luxury retail and premium home goods
2. Wedding and event services
3. Furniture and home decor shopping
4. Product catalog browsing
5. Product detail pages
6. Collections and wishlists
7. Quote-request and inquiry experiences

Evaluate: hero composition, navigation and menu structure, typography, photography and image treatment, category presentation, product detail layouts, filtering and browsing, mobile, calls to action, premium details.

**Starting directions** (the research confirms or replaces them):

| | A. Timeless Luxury | B. Modern Editorial | C. Romantic Boutique |
|---|---|---|---|
| Feel | Ivory, champagne, warm neutrals; elegant serif; large editorial photography | Crisp type, dramatic photography, strong grids, restrained colour | Soft colours, refined details, layered photography, vintage-inspired touches |
| Best for | Premium weddings, sophisticated events | Modern weddings, planners, corporate events | Boutique weddings, curated tabletop collections |

A reasonable starting recommendation: A, with some of B's modern simplicity. The skill must still justify the final recommendation from the references it actually found.

**Illustrative homepage outline** (a wireframe, not a design):

```
LOGO                      Collections · About · FAQ · Contact
[Hero image]  Headline about gatherings at the table
              One line on curated tabletop rentals for events in {cities}
              [Explore our collections →]
The Collections:   China · Flatware · Glassware
Brand statement + supporting line
How rentals work:  1 Browse → 2 Create wishlist → 3 Request quote
```

**Pages for the prototype phase (after homepage approval):** Home, About, Shop/Collections, Collection category, Product detail, Wishlist / Request a quote, FAQ, Contact, Service areas ({cities}).

**Inventory.** If the client uses a rental inventory platform (for example RW Elephant, which offers hosted galleries, wishlists and website integrations), that platform is the source of truth. Prototype with mock inventory behind an adapter that supports categories, products, images, descriptions and prices when available, and the wishlist/inquiry behaviour of the integration chosen later. Do not build a duplicate inventory system. Confirm the integration method with the vendor before connecting it.

**Prototype approval checklist.**

- [ ] Three homepage concepts reviewed
- [ ] Preferred design selected
- [ ] Desktop and mobile layouts approved
- [ ] Product catalog demonstrated with sample inventory
- [ ] Inventory integration approach documented
- [ ] Service-area content reviewed
- [ ] Client preview deployed to a private portal
- [ ] Client approval received before full implementation
