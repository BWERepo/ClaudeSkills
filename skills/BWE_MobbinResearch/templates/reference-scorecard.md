# Reference scorecard (`candidates.json`)

`scripts/score.mjs` reads this shape. Fill only fields the Mobbin tool (or the user) actually provided; leave unknown fields out.

```json
{
  "project": "{project name}",
  "retrieved": "YYYY-MM-DD",
  "weights": { "visual": 30, "relevance": 25, "usability": 20, "mobile": 15, "distinct": 10 },
  "required": ["homepage", "navigation", "catalog", "detail", "forms", "mobile", "conversion"],
  "shortlist": { "min": 5, "max": 8, "perApp": 2, "perFunction": 2 },
  "candidates": [
    {
      "id": "c01",
      "app": "App or site name as returned",
      "source": "mobbin | mobbin-chat | manual | fixture",
      "tool": "search_sections",
      "query": "editorial hero with full-bleed photography",
      "kind": "section | screen | flow",
      "function": "homepage",
      "pattern": "full-bleed hero, serif headline, single CTA",
      "platform": "web | ios | android",
      "link": "Mobbin URL if returned",
      "image_url": "high-res image URL if returned (expires after 30 days)",
      "scores": { "visual": 8, "relevance": 7, "usability": 8, "mobile": 6, "distinct": 7 },
      "reasons": {
        "visual": "one line",
        "relevance": "one line",
        "usability": "one line",
        "mobile": "one line",
        "distinct": "one line"
      },
      "strengths": ["..."],
      "weaknesses": ["..."],
      "adapt": ["specific element worth adapting"]
    }
  ]
}
```

`function` values: `homepage`, `navigation`, `catalog`, `detail`, `forms`, `journey`, `mobile`, `conversion`, or any project-specific value listed in `required`.

Commands:

```
node scripts/score.mjs rank candidates.json [--md]
node scripts/score.mjs shortlist candidates.json [--md]
```
