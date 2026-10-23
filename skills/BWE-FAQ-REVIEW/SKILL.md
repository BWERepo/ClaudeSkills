---
name: BWE-FAQ-REVIEW
description: Walks the owner through reviewing the FAQ proposal and the FAQs held as NEEDS REVIEW, then applies the accepted proposal to the registry. Presents each new FAQ with its source quote, confidence and category, flags sensitive answers (money, policy, legal, medical, financial), resolves duplicates and held items with the owner, and runs apply. Use when the user says "review the FAQs", "approve the FAQs", "apply the proposal", "what needs review", or invokes /BWE-FAQ-REVIEW, after /BWE-FAQ-GENERATE.
---

# BWE-FAQ-REVIEW

Runs the REVIEW and APPLY stages. The owner decides; the skill never approves on their behalf.

## Steps

1. **Read the state.** `node faq/engine/src/cli.mjs status` and open `.faq/proposal.md`. If there is no proposal, send the owner to `/BWE-FAQ-GENERATE`.
2. **Present the proposal in plain language**, a few items at a time, never a wall of text. For each new FAQ show the question, the answer, its category, CONFIRMED or DERIVED, and the
   source quote. Call out separately:
   - anything proposed as NEEDS REVIEW and its reason (quote not found, unsupported number, broken link)
   - answers about money, policy, legal, medical or financial topics (the owner reads these themselves; source-checked is not owner-approved)
   - merged duplicates (confirm the surviving question is the right one)
   - page FAQs repeated across many pages (kept; offer to consolidate deliberately)
3. **Take the owner's decisions.** Edit `faq/candidates.json` to reword, remove or correct a candidate, then rerun `propose`. Use `apply --drafts-only` if the owner wants everything added
   unpublished first. Never reword an answer past what its source quote supports.
4. **Apply** only after the owner says go: `node faq/engine/src/cli.mjs apply`. It never overwrites an existing or hand-edited answer. Report how many were added (ACTIVE) and how many were held.
5. **Held items.** For each NEEDS REVIEW FAQ, ask the owner to fix the site text, correct the candidate, or retire it (set `status` to `RETIRED` in `faq/faq-registry.json`; never delete).
6. **Hand off:** "Next: `/BWE-FAQ-PUBLISH`."

## Never

Apply without the owner seeing the proposal, publish an UNKNOWN answer, delete a FAQ, or change a hand-edited answer.
