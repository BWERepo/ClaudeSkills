// Dependency-free parsers shared by the post-publication check, the city landing-page module and any Worker or browser
// caller (no node: imports, no I/O). Moved verbatim out of post-publish-check.mjs.

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(s) {
  return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}


export function parseRobots(txt) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(txt ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") sitemaps.push(value);
    else if ((key === "allow" || key === "disallow") && current)
      current.rules.push({ type: key, path: value });
  }
  return { groups, sitemaps };
}

function ruleMatches(pattern, path) {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(
    "^" +
      body
        .split("*")
        .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      (anchored ? "$" : ""),
  );
  return re.test(path);
}

// Google's rules: a crawler obeys only its most specific matching group (else "*"); within it the
// longest matching rule wins and Allow wins a tie. No matching rule = allowed.
export function robotsAllows(robots, agent, path) {
  const ua = agent.toLowerCase();
  let best = null;
  let bestLen = -1;
  for (const g of robots.groups) {
    for (const a of g.agents) {
      if (a !== "*" && ua.startsWith(a) && a.length > bestLen) {
        best = [g];
        bestLen = a.length;
      } else if (a !== "*" && ua.startsWith(a) && a.length === bestLen) best.push(g);
    }
  }
  const groups = best ?? robots.groups.filter((g) => g.agents.includes("*"));
  let winner = null;
  for (const rule of groups.flatMap((g) => g.rules)) {
    if (!ruleMatches(rule.path, path)) continue;
    const len = rule.path.length;
    if (
      !winner ||
      len > winner.path.length ||
      (len === winner.path.length && rule.type === "allow")
    )
      winner = rule;
  }
  return {
    allowed: !winner || winner.type === "allow",
    rule: winner ? `${winner.type}: ${winner.path}` : null,
    group: best ? best[0].agents.join(", ") : groups.length ? "*" : "(no group)",
  };
}


export function parseSitemap(xml) {
  const src = String(xml ?? "");
  const kind = /<sitemapindex\b/i.test(src) ? "index" : /<urlset\b/i.test(src) ? "urlset" : "unknown";
  const locs = [...src.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) =>
    decodeEntities(m[1]).trim(),
  );
  // Engine 1.7.0: each entry with its lastmod, and whether the file is structurally sound.
  const entries = [...src.matchAll(/<(url|sitemap)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({
    loc: decodeEntities(m[2].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1] ?? "").trim(),
    lastmod: (m[2].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i)?.[1] ?? "").trim() || null,
  }));
  const count = (re) => (src.match(re) ?? []).length;
  const unbalanced =
    count(/<url\b/gi) !== count(/<\/url>/gi) ||
    count(/<sitemap\b/gi) !== count(/<\/sitemap>/gi) ||
    count(/<loc>/gi) !== count(/<\/loc>/gi);
  return {
    kind,
    locs,
    entries,
    malformed: kind === "unknown" || unbalanced || (locs.length === 0 && src.trim() !== ""),
  };
}

