import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, loadCities } from "./seo-landing-city.mjs";
import { renderUrlset } from "./landing-city.mjs";

const origin = "https://www.example.test";
const body = (n) => Array.from({ length: 700 }, (_, i) => `word${n}x${(i * 7 + n) % 211}`).join(" ");
const page = (n) => ({ title: `Site design in City${n}`, description: `A plain description of the service for City${n} businesses, written long enough to pass the length check easily.`, h1: `Design for City${n}`, headings: ["a", "b", "c"], body: body(n) + " See Your Free Prototype", cta: "See Your Free Prototype", links: ["/pricing", "/about"], faq: [] });
const brief = { city: "Springfield", state: "ZZ", availability: { status: "verified" }, facts: [{ claim: "Remote service", status: "business-provided" }], sources: [{ url: "https://s.example/a", retrievedOn: "2026-10-21" }] };
const setup = () => {
  const cwd = mkdtempSync(join(tmpdir(), "city-"));
  mkdirSync(join(cwd, "seo"), { recursive: true });
  writeFileSync(join(cwd, "seo", "content-inventory.json"), JSON.stringify({ pages: [{ url: "/pricing", status: "published" }, { url: "/about", status: "published" }, { url: "/old-city-web-design", status: "published" }] }));
  writeFileSync(join(cwd, "sitemap.xml"), renderUrlset([{ loc: `${origin}/`, lastmod: "2026-01-01" }]));
  writeFileSync(join(cwd, "robots.txt"), `User-agent: *\nDisallow: /admin\nSitemap: ${origin}/sitemap.xml\n`);
  writeFileSync(join(cwd, "brief.json"), JSON.stringify(brief)); writeFileSync(join(cwd, "page.json"), JSON.stringify(page(1)));
  return cwd;
};
const run = async (cwd, args, extra = {}) => { const lines = []; const code = await main(args, { cwd, out: (l) => lines.push(l), now: new Date("2026-10-21T12:00:00Z"), ...extra }); return { code, text: lines.join("\n") }; };

describe("city CLI wizard", () => {
  it("walks add -> brief -> draft -> package -> approve -> published", async () => {
    const cwd = setup();
    expect((await run(cwd, ["add", "Springfield", "ZZ"])).code).toBe(0);
    expect((await run(cwd, ["add", "Springfield", "ZZ"])).text).toContain("already registered");
    const id = "springfield-zz-web-design";
    expect((await run(cwd, ["draft", id, "--page", "page.json"])).code).toBe(1); // no brief yet
    expect((await run(cwd, ["brief", id, "--file", "brief.json"])).code).toBe(0);
    const d = await run(cwd, ["draft", id, "--page", "page.json", "--cta", "See Your Free Prototype"]);
    expect(d.text).toContain("READY FOR REVIEW");
    expect((await run(cwd, ["published", id, "--by", "Owner"])).code).toBe(1); // not approved
    const p = await run(cwd, ["package", "--origin", origin, "--sitemap", "sitemap.xml", "--robots", "robots.txt"]);
    const hash = /package (\w{64})/.exec(p.text)[1];
    expect(p.text).toContain("+1 -0");
    expect((await run(cwd, ["approve", "--package", "bad", "--by", "Owner"])).code).toBe(1);
    expect((await run(cwd, ["approve", "--package", hash, "--by", "Owner"])).code).toBe(0);
    expect((await run(cwd, ["published", id, "--by", "Owner"])).code).toBe(0);
    expect(loadCities(cwd).entries[0].status).toBe("published");
  });
  it("blocks a route that already exists on the site", async () => {
    const cwd = setup();
    const r = await run(cwd, ["add", "Old City", "ZZ", "--path", "/old-city-web-design"]);
    expect(r.code).toBe(1); expect(r.text).toContain("already exists");
  });
  it("blocks an unverified brief", async () => {
    const cwd = setup(); await run(cwd, ["add", "Springfield", "ZZ"]);
    writeFileSync(join(cwd, "b2.json"), JSON.stringify({ ...brief, availability: { status: "unknown" } }));
    expect((await run(cwd, ["brief", "springfield-zz-web-design", "--file", "b2.json"])).text).toContain("BRIEF BLOCKED");
  });
  it("verify reports live problems and never claims indexing", async () => {
    const cwd = setup(); const id = "springfield-zz-web-design";
    await run(cwd, ["add", "Springfield", "ZZ"]); await run(cwd, ["brief", id, "--file", "brief.json"]); await run(cwd, ["draft", id, "--page", "page.json", "--cta", "See Your Free Prototype"]);
    const p = await run(cwd, ["package", "--origin", origin, "--sitemap", "sitemap.xml", "--robots", "robots.txt"]);
    await run(cwd, ["approve", "--package", /package (\w{64})/.exec(p.text)[1], "--by", "Owner"]); await run(cwd, ["published", id, "--by", "Owner"]);
    const url = `${origin}/springfield-web-design`;
    const mk = (map) => async (u) => { const r = map[u] ?? { status: 404, text: "" }; return { status: r.status, text: async () => r.text, headers: new Headers(r.headers ?? {}) }; };
    const good = { [origin + "/sitemap.xml"]: { status: 200, text: renderUrlset([{ loc: url, lastmod: "2026-10-21" }]) }, [origin + "/robots.txt"]: { status: 200, text: `User-agent: *\nSitemap: ${origin}/sitemap.xml\n` }, [url]: { status: 200, text: `<html><head><link rel="canonical" href="${url}"><title>t</title></head><body>x</body></html>` } };
    const ok = await run(cwd, ["verify", "--origin", origin], { fetchImpl: mk(good) });
    expect(ok.text).toContain("VERIFIED"); expect(ok.text).toContain("not indexed");
    const bad = await run(cwd, ["verify", "--origin", origin], { fetchImpl: mk({ ...good, [url]: { status: 200, text: `<html><head><meta name="robots" content="noindex"><link rel="canonical" href="${origin}/other"></head></html>` } }) });
    expect(bad.code).toBe(1); expect(bad.text).toContain("noindex"); expect(bad.text).toContain("canonical");
    const missing = await run(cwd, ["verify", "--origin", origin], { fetchImpl: mk({ ...good, [url]: { status: 404, text: "" } }) });
    expect(missing.text).toContain("status 404");
  });
});
