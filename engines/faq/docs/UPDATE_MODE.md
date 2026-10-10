# Update mode

`faq-engine update` (= `scan` + `propose`) never regenerates the collection. It re-checks what exists and proposes only what is new.

| Situation | What the engine does |
| --- | --- |
| New candidate means the same as an existing FAQ | merged away (listed in the proposal), nothing added |
| New candidate with a verified quote | proposed ACTIVE (CONFIRMED/DERIVED) or NEEDS REVIEW with the reason |
| A cited page was removed or moved | item flagged NEEDS REVIEW ("source page removed or moved") |
| Cited text changed or removed | flagged NEEDS REVIEW ("supporting text changed or removed") |
| Page changed but the cited text is still there | stays ACTIVE; the stored page hash is refreshed and the change is reported |
| An answer no longer matches its sources or a number is unsupported | flagged NEEDS REVIEW (unless hand-written, see next) |
| Answer edited by hand (`origin: manual`, or text differs from the generated hash) | preserved exactly; only flagged if its source evidence disappears |
| Broken internal link in an answer | flagged NEEDS REVIEW with the link |
| RETIRED item | left alone; its id and anchors stay reserved |
| FAQs repeated across many pages | listed in the report for deliberate consolidation; never deleted |

`apply` then writes the accepted changes. Nothing is destructive: items are flagged or retired, never deleted, and the proposal is always shown first.
