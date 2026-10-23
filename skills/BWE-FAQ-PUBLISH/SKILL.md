---
name: BWE-FAQ-PUBLISH
description: Gets the FAQ page working on the site and ready to publish - helps wire the engine's rendered FAQ HTML, stylesheet and script into the site's FAQ page, then builds the SEO export and runs the engine's validation, and walks the owner through the final check before they publish. Use when the user says "show the FAQs on the page", "wire the FAQ page", "publish the FAQs", "build the FAQ registry", "validate the FAQs", or invokes /BWE-FAQ-PUBLISH, after /BWE-FAQ-REVIEW.
---

# BWE-FAQ-PUBLISH

Runs WIRE PAGE, BUILD, VALIDATE and the owner's PUBLISH. It never deploys by itself.

## Steps

1. **Read the state.** `node faq/engine/src/cli.mjs status`. If there are no ACTIVE FAQs, send the owner to `/BWE-FAQ-REVIEW`.
2. **Wire the page.** In the site's FAQ page template (or a build step), render with the engine and insert the result, following the "Showing the FAQs on a page" section of the manual
   (`faq/engine/docs/USER_MANUAL.md`):
   ```js
   import { loadConfig, loadRegistry, buildAll, renderFaq } from './faq/engine/src/index.mjs';
   const cfg = loadConfig('faq/faq.config.json');
   const { items, organised, jsonLd } = buildAll(cfg, loadRegistry(cfg), null);
   const faqHtml = renderFaq({ items, organised, cfg });
   ```
   Include `faq/engine/client/faq.css` and call `initFaq()` from `faq/engine/client/faq-client.js`. Fit the site's framework and design; do not redesign the site. Add the FAQPage JSON-LD
   only if `schema.faqPage` is on and the owner agrees, and never alongside another FAQPage block on the same page.
3. **Build the site, then the export.** `node faq/engine/src/cli.mjs build` writes the SEO registry (`seo/faq-registry.json`).
4. **Validate.** `node faq/engine/src/cli.mjs validate`. Fix every error (the output names the FAQ and the problem); repeat until it reports 0 errors. Warnings are shown to the owner.
5. **Check in a browser together.** Categories must start collapsed; search appears only at `searchThreshold`; a deep link such as `/faq#<anchor>` opens its category and scrolls to the
   answer; links work; the layout works on a phone. Say plainly that validation does not replace a screen-reader check or an external structured-data test.
6. **Hand to the owner.** "The FAQ page is ready. It is not live until you publish your site the way you normally do." Do not deploy, commit or push unless asked.

## Never

Deploy, claim the page is live, add FAQ markup against the site's policy, or show FAQs in structured data that visitors cannot see on the page.
