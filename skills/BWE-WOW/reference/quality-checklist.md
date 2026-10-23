# BWE-WOW quality checklist (report only what you actually ran or saw)

## Functionality
Inputs still produce the same outputs for fixed test values (compare answers before and after). Forms submit, links navigate, menus open, filters and search work, auth areas untouched. No business logic, calculation or API file in the diff; if one is, justify or revert.

## Accessibility (aim WCAG 2.2 AA)
Text contrast 4.5:1 (3:1 large text and UI), visible focus on every control, full keyboard path, semantic landmarks and headings in order, every input has a label, status not colour only, results announced via live region where the page already had one, touch targets about 44px, text reflows at 320px and 200% zoom, `prefers-reduced-motion` respected.

## Performance
No new heavy library for cosmetics; prefer CSS; no layout shift from late fonts or images (size images, `font-display`); no extra render-blocking requests; animations cheap (transform, opacity); images optimised.

## SEO
Title, meta description, canonical, headings, structured data, robots meta and sitemap behaviour unchanged. Do not hide meaningful text.

## Rendering
No console errors introduced; no horizontal overflow at 1440, 768, 375 and 320; both colour themes if the site has them; empty, error and long-content states; shared-component dependants checked on representative pages.

## Tests
Run the repo's type check, lint, unit tests, build and built-site tests; browser tests unless the repo disables them. List anything skipped and why. Never claim a pass that did not run.

## Honest limits
State what was not verified (other browsers, real devices, screen readers, pages outside the pilot).
