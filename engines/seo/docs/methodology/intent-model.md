# Customer-intent model

Classify every opportunity by what the searcher is trying to do. The same topic can hold
several intents; pick the **primary** one a page will satisfy.

| Intent | The searcher… | Example (generic) | Page type that fits | Conversion distance |
|---|---|---|---|---|
| High commercial | needs the service now and is choosing a provider | "<city> <service> company" | Service or location page with a clear CTA | Shortest |
| Service | wants a specific service | "<service> for <customer type>" | Service page | Short |
| Local | needs someone in a place | "<service> near <town>" | Location page / service page with real local detail | Short |
| Comparison | is weighing options | "<option A> vs <option B>", "<tool> alternatives for businesses" | Honest comparison guide → CTA | Medium |
| Problem / solution | has a problem the business solves | "why is my <thing> not <result>" | Diagnostic guide → service CTA | Medium |
| Informational | is learning | "what is <concept>", "how much does <service> cost" | Guide / resource | Longer |
| Navigational | wants this business | brand name | Home / contact | — |

## Rules

- Informational content must connect logically to a conversion. If a reader of the page can't
  plausibly become a customer, don't create it.
- Cost questions ("how much does X cost") are informational in form but commercial in effect —
  treat them as high-value when the business can publish verified prices.
- DIY-intent searches (people wanting to build it themselves) convert poorly for a service
  business; include only when the page can honestly serve "you tried DIY and it isn't working".
- For each intent, write down **who** searches it (role, situation) and **what they need to see**
  to take the next step (price, proof, process, availability, trust).

## Output per opportunity

`query cluster · primary intent · secondary intents · searcher persona · what they need to see ·
matching verified offering (or "none — reject/flag") · conversion path`.
