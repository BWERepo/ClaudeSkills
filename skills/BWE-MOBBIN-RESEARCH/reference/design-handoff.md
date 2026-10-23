# Design handoff

## Preconditions

- A recorded approval exists: a `decision.md` in a run folder and an entry in `docs/design/design-decisions.md`. Without it, handoff mode stops and offers research mode.
- If `BWE-DESIGN-SPEC.md` exists, summarise what would change and ask before replacing it. Keep the old version's "Approved" items unless the new decision overrides them.

## Spec contents (`templates/design-specification.md`)

Required sections; `scripts/score.mjs check-spec` checks the headings:

1. Project overview
2. Approval record (who, date, decision, run folder)
3. Approved design direction
4. Brand and visual principles
5. Color tokens (name, HEX, role, contrast pairs)
6. Typography scale (role, family, size desktop/mobile, weight, line-height)
7. Spacing system
8. Layout grids and breakpoints
9. Navigation patterns
10. Page composition (per page: sections in order and their reference)
11. Component specifications
12. Responsive behavior
13. Accessibility requirements
14. Animation guidelines
15. SEO preservation (always present; "BWE-SEO not detected" if absent)
16. Approved references (rank, source label, link, element adopted)
17. Implementation priorities
18. Acceptance criteria (testable statements)
19. Unresolved recommendations (not approved)

Mark every decision **Approved** or **Recommendation (not approved)**. Never upgrade a recommendation to approved without the user saying so.

Tokens should be implementable as written: CSS custom properties or the project's existing token system (Tailwind theme, SCSS variables). Match what the project already uses; do not introduce a new styling dependency.

## Optional prototype brief (`docs/design/prototype-brief.md`)

When the user wants competing homepage concepts:

- Three concepts, the same content, different approved treatments (or one approved direction plus two named variations).
- Desktop (1440) and mobile (375) for each.
- Sample or placeholder data for anything that comes from an external system, behind a replaceable adapter.
- Build none of it until the user gives a separate go-ahead. Show previews and wait for a choice before building other pages.

## After the build

- Recommend the Impeccable skills for refinement (typography, spacing, composition, colour, responsiveness) with before/after screenshots and approval for each change. This skill does not apply visual changes.
- Recommend `compare` mode to score built prototypes against the spec.

## SEO preservation (when BWE-SEO or other SEO tooling is present)

The spec must state that implementation keeps metadata, canonical URLs, structured data, internal links, the sitemap, heading hierarchy (one H1 per page) and accessible navigation. Design research never changes SEO configuration.
</content>
</invoke>
