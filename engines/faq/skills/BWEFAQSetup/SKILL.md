---
name: BWEFAQSetup
description: Configures the FAQ Engine for the current website after it is installed (/BWEFAQInstall). Fills faq/faq.config.json from the site's real structure and the owner's answers - site name and URL, the content adapter (built-output folder or JSON export), the FAQ page path, categories, exclusions, structured-data policy and answer tokens - flagging missing facts instead of inventing them. Use when the user says "set up the FAQ engine", "configure FAQs", "FAQ setup", or invokes /BWEFAQSetup, in any website project.
---

# BWEFAQSetup

Setup is the **site-specific** phase. The engine is installed separately by `/BWEFAQInstall`.

## Step 0: the engine must be installed

Check `faq/engine/INSTALL.json` and `faq/faq.config.json`. If either is missing, stop: "The FAQ Engine is not installed in this project. Run `/BWEFAQInstall` first (start with `--dry-run`)."
Do not copy engine files by hand.

## Steps

1. **Read, don't assume.** Look at the site: framework, where built HTML lands (for example `dist`), existing FAQ page and route, navigation, sitemap, existing FAQ content, any schema/SEO
   system, and the site's own name and canonical URL.
2. **Ask the owner only what the site cannot tell you**, in plain questions, one topic at a time:
   - site name and canonical URL (`site.name`, `site.url`)
   - the content adapter: `html-dir` with the build folder, or `json` (a `{ "pages": [...] }` file the site exports) when content lives in code or a CMS
   - the FAQ page path (`faqPage.path`, default `/faq`), title and description
   - categories the site's content really supports (`id`, `title`, `keywords`, `pages`), and the fallback category. Do not create a taxonomy the site does not need.
   - exclusions: page prefixes and question patterns that must never become FAQs (admin, drafts, private areas)
   - structured data: set `schema.faqPage` to `false` if the site's policy forbids FAQ markup; otherwise leave it on (rich results are never guaranteed)
   - tokens such as a contact page name used in answers (`tokens`), and external hosts allowed in links (`externalHosts`)
3. **Write `faq/faq.config.json`** with only the settings the owner confirmed; leave defaults alone. Show the diff and get approval.
4. **Check it.** Run `node faq/engine/src/cli.mjs status`; the CONFIGURE stage should now be done and the next step SCAN.
5. **Hand off:** "Configuration saved. Next: build the site, then `/BWEFAQGenerate`."

## Never

Invent a site name, URL, category, policy or contact detail; guess an adapter; edit `faq/engine/`; deploy.
