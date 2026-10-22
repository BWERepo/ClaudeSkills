# Evaluation rubric

## Default weights

| Key | Criterion | Weight |
|---|---|---|
| `visual` | Visual sophistication | 30 |
| `relevance` | Industry and audience relevance | 25 |
| `usability` | Usability and clarity | 20 |
| `mobile` | Mobile experience | 15 |
| `distinct` | Distinctiveness | 10 |

Weights are per project. Override them with the invocation (`--weights visual=25,relevance=30,...`) or a `docs/design/rubric.json` file (`{"weights": {...}}`) in the project. They must total 100. Record the weights used in the report.

## Scoring anchors (1-10)

| Score | Meaning |
|---|---|
| 9-10 | Exemplary; would be a reference for professionals in this category |
| 7-8 | Strong; clear lessons to adapt |
| 5-6 | Competent; one or two useful details |
| 3-4 | Weak for this brief |
| 1-2 | Wrong fit or poor execution |

Per criterion:

- **Visual sophistication:** type pairing and scale, spacing rhythm, image treatment, colour restraint, detail quality.
- **Relevance:** fit with this audience, price tier and conversion action. Adjacent-industry examples can score high when the pattern transfers directly.
- **Usability:** hierarchy, scannability, labels, affordances, form length, error handling, accessibility signals (contrast, target sizes, focus).
- **Mobile:** a mobile screen or responsive evidence exists and works. With no mobile evidence, score at most 5 and say "no mobile evidence".
- **Distinctiveness:** avoids generic template looks; memorable without hurting usability.

Every score needs a one-line reason. Scores are reviewer judgment against the brief, not measured performance; the report says so.

## Weighted score

`weighted = Σ(score × weight) / Σ(weight)`, rounded to one decimal (scale 1-10). `scripts/score.mjs rank` computes it; do not compute by hand.

## Duplicates

The script flags candidates as duplicates when they share a Mobbin link or `image_url`, or the same app plus the same normalised pattern. Keep the higher-scoring one unless the other shows a different viewport (desktop vs mobile).

## Shortlist diversity

`scripts/score.mjs shortlist` takes candidates in rank order and skips any that would put more than 2 references from the same app, or more than 2 for the same function, on the list. It then fills each required function with no coverage (default: homepage, navigation, catalog, detail, forms, mobile, conversion; set `required` in the candidates file to change) using that function's best remaining candidate; when the list is full, the gap-filler replaces the lowest-ranked pick whose function is covered twice. Coverage beats the per-app limit, and the output says when that happens. Functions with no candidate at all are reported as uncovered. Default size 5-8.
