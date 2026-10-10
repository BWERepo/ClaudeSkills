---
name: BWEFAQGenerate
description: Creates the FAQ candidates for the current website - scans the built site, helps author candidate questions with exact source quotes, and runs the engine's propose step (duplicate check, grounding, categories, link proposals) without changing the registry. Use when the user says "generate FAQs", "create the FAQs", "scan the site for FAQs", "propose FAQs", or invokes /BWEFAQGenerate, after /BWEFAQSetup.
---

# BWEFAQGenerate

Runs the SCAN and PROPOSE stages. It changes nothing in `faq/faq-registry.json`.

## Step 0: guard

Run `node faq/engine/src/cli.mjs status`. If the engine is not installed or the configuration is unfinished, send the owner to `/BWEFAQInstall` or `/BWEFAQSetup` and stop. Make sure the
site has been **built** (the `html-dir` adapter reads built output); if not, say so and ask the owner to build it.

## Steps

1. **Scan.** `node faq/engine/src/cli.mjs scan`. Report the page count, how many are indexable and how many FAQs already exist. If the count looks wrong, check `exclusions.pages` and
   the adapter folder with the owner.
2. **Find the questions.** Read the site's real pages (pricing, how it works, policies, contact, tools, articles, existing FAQs). Look for what a visitor would reasonably ask, including
   answers that exist but are hard to find. Do not invent questions from templates, and do not use search-volume or competitor claims.
3. **Author candidates** in `faq/candidates.json`:
   ```json
   { "candidates": [ { "question": "…?", "answer": "First sentence answers directly. See [Page](/path).",
       "sources": [ { "url": "/page", "quote": "exact sentence copied from that page" } ], "relatedPages": ["/page"] } ] }
   ```
   Rules: the quote must be copied exactly from the cited page; every number, price or percentage in the answer must appear in that text; one natural question per intent (no
   variations); links only where they help. If the site does not say it, do not write the answer.
4. **Propose.** `node faq/engine/src/cli.mjs propose`. It writes `.faq/proposal.md` and changes nothing else.
5. **Hand off:** summarize new / merged duplicates / skipped, and say "Next: `/BWEFAQReview`".

## Never

Fabricate a quote, alter a quote to make it match, answer from general knowledge, or run `apply` (that is `/BWEFAQReview`, after the owner has seen the proposal).
