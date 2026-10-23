---
name: BWE-FAQ-REFRESH
description: Reruns the FAQ Engine after the website has changed - runs update (scan plus propose), explains what changed, which FAQs are still accurate, which are flagged NEEDS REVIEW or obsolete, what new questions are proposed, and which links broke, then guides review, apply, build and validate. Never regenerates the whole collection and never overwrites hand-edited answers. Use when the user says "update the FAQs", "the site changed", "refresh the FAQs", "check the FAQs are still accurate", or invokes /BWE-FAQ-REFRESH, in any website with the FAQ Engine installed.
---

# BWE-FAQ-REFRESH

## Steps

1. **Guard.** Run `node faq/engine/src/cli.mjs status`. If the engine is not installed, send the owner to
   `/BWE-FAQ-ENGINE install`. Make sure the site was rebuilt after its content changed.
2. **Update.** `node faq/engine/src/cli.mjs update` (scan plus propose). Nothing is changed in the registry; read `.faq/proposal.md`.
3. **Explain in plain language**, following `faq/engine/docs/UPDATE_MODE.md`: new questions proposed, duplicates merged, existing FAQs flagged NEEDS REVIEW (source page removed or moved, cited text
   changed, answer no longer supported, broken link), changes that left the cited text intact (still accurate), and repeated page FAQs.
4. **Review with the owner** as in `/BWE-FAQ-REVIEW`. Hand-edited answers are preserved and are flagged only when their source evidence disappears. Obsolete FAQs are proposed for RETIRED, never
   deleted.
5. **Apply, build, validate** (`apply`, `build`, `validate`), then remind the owner to publish.

## Never

Regenerate everything, overwrite a hand-edited answer, delete a FAQ, or publish a held item.
