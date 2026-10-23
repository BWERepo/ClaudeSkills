# BWE Design Specification — Example tabletop event rental

> **ILLUSTRATIVE EXAMPLE.** Shows the spec's shape. References are placeholders, not Mobbin results; the approval row is an example.

Status legend: **Approved** = decided by the owner. **Recommendation (not approved)** = proposed, still open.

## Project overview
Premium tabletop rental website for {primary city} and {secondary city}. Goal: browse collections, build a wishlist, request a quote.

## Approval record
| Date | Approved by | Decision | Run |
|---|---|---|---|
| 2026-10-22 | Owner (example) | Direction A with B's grid for catalog pages | `docs/design/mobbin-research/2026-10-22-research/` |

## Approved design direction
**Approved:** A. Timeless Luxury, with B. Modern Editorial's 12-column grid for catalog and product pages.

## Brand and visual principles
**Approved:** photography leads; generous but purposeful space; one action per section; no stock that misrepresents the inventory.

## Color tokens
| Token | HEX | Role | Contrast | Status |
|---|---|---|---|---|
| --color-bg | #FAF7F2 | page background | — | Approved |
| --color-surface | #F1EAE0 | cards, panels | — | Approved |
| --color-text | #2B2622 | body text | 14.0:1 on bg | Approved |
| --color-muted | #6E655C | secondary text | 5.3:1 on bg | Approved |
| --color-accent | #8C7A5B | large headings, rules, icons (not body links) | 3.9:1 on bg (large text and UI only) | Approved |
| --color-accent-ink | #FFFFFF | text on accent buttons | 4.2:1 (fails 4.5:1 for body-size text) | Recommendation (not approved) |

## Typography scale
| Role | Family | Desktop | Mobile | Weight | Line-height | Status |
|---|---|---|---|---|---|---|
| Display | High-contrast serif (licensed or free; confirm) | 64px | 40px | 400 | 1.05 | Approved |
| H2 | same serif | 40px | 30px | 400 | 1.15 | Approved |
| Body | Light humanist sans | 18px | 16px | 400 | 1.6 | Approved |
| Label | same sans, tracked caps | 13px | 12px | 500 | 1.3 | Recommendation (not approved) |

## Spacing system
**Approved:** 4px base; steps 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.

## Layout grids
**Approved:** 12 columns, 24px gutters, 1280px max content width; breakpoints 375, 768, 1024, 1440.

## Navigation patterns
**Approved:** minimal top bar (Collections, About, FAQ, Contact) with wishlist count; mobile full-screen menu with large tap targets.

## Page composition
Home: hero [REF-2] → collections trio [REF-1] → brand statement → how rentals work (Browse → Wishlist → Request quote) [REF-3] → service areas → footer. **Approved.**

## Component specifications
Buttons (primary filled, secondary outline), collection card, product card, gallery, wishlist panel [REF-3], quote form [REF-6]; all with hover, focus, disabled and error states.

## Responsive behavior
Collections trio stacks on mobile; product grid 4 → 2 columns; wishlist panel becomes a bottom sheet.

## Accessibility requirements
WCAG 2.1 AA; visible focus; 44px targets; alt text for every product image; labelled form fields with inline errors; `prefers-reduced-motion` honoured.

## Animation guidelines
**Approved:** fades of 200-400ms; no parallax; no autoplay carousels.

## SEO preservation
BWE-SEO detected (example): keep metadata, canonicals, structured data, internal links, sitemap, one H1 per page and heading order.

## Approved references
| Rank | Reference | Source | Link | Element adopted |
|---|---|---|---|---|
| 1 | [REF-1] | mobbin | (link) | collection grid rhythm |
| 2 | [REF-2] | mobbin | (link) | editorial hero |
| 3 | [REF-3] | mobbin | (link) | wishlist → inquiry flow |

## Implementation priorities
1. Tokens and type. 2. Home (three concepts first, if a prototype brief exists). 3. Collections and product detail with mock inventory behind an adapter. 4. Wishlist and quote request.

## Acceptance criteria
- Body text contrast is at least 4.5:1 on every background token.
- Home loads with LCP under 2.5s on a mid-range phone.
- Every page works by keyboard alone.
- Inventory data comes only through the adapter; no vendor endpoint is hard-coded.

## Unresolved recommendations (not approved)
- Label style (tracked caps).
- Text colour on accent buttons.
- Inventory integration method: needs confirmation from the inventory vendor.
