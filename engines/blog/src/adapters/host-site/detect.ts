import type { SafeFs } from "../../core/util/safe-fs.js";

/**
 * Framework, build, hosting, CMS and database detection from a site checkout.
 * Pure inspection: reads manifest/config files only.
 */

export interface StackDetection {
  framework: string;
  frameworkVersion?: string;
  buildSystem: string;
  routing: string;
  hosting: string;
  cms: string;
  database: string;
  outputDirCandidates: string[];
  contentDirCandidates: string[];
  sitemapGenerator: string;
  metadata: string;
  canonical: string;
  notes: string[];
}

type Deps = Record<string, string>;

const FRAMEWORKS: [dep: string, name: string, output: string[], routing: string, metadata: string][] = [
  ["next", "Next.js", ["out", ".next/server/app", ".next/server/pages"], "file-based (app/ or pages/)", "Next.js Metadata API / next/head"],
  ["astro", "Astro", ["dist"], "file-based (src/pages)", "Astro layout <head>"],
  ["nuxt", "Nuxt", [".output/public", "dist"], "file-based (pages/)", "useHead / nuxt.config app.head"],
  ["@sveltejs/kit", "SvelteKit", ["build", ".svelte-kit/output/prerendered/pages"], "file-based (src/routes)", "<svelte:head>"],
  ["gatsby", "Gatsby", ["public"], "file-based (src/pages) + createPages", "Gatsby Head API / react-helmet"],
  ["@remix-run/react", "Remix", ["build/client", "public/build"], "file-based (app/routes)", "meta exports"],
  ["@docusaurus/core", "Docusaurus", ["build"], "file-based (docs/, blog/)", "Docusaurus front matter"],
  ["vitepress", "VitePress", [".vitepress/dist", "docs/.vitepress/dist"], "file-based (Markdown)", "VitePress frontmatter"],
  ["@11ty/eleventy", "Eleventy", ["_site"], "file-based (templates)", "layout front matter"],
  ["hexo", "Hexo", ["public"], "Markdown posts", "theme layouts"],
  ["react-scripts", "Create React App", ["build"], "client-side router", "react-helmet / index.html"],
  ["vue", "Vue", ["dist"], "client-side router", "index.html / vue-meta"],
  ["svelte", "Svelte", ["dist", "public"], "client-side", "index.html"],
  ["react", "React", ["dist", "build"], "client-side router", "index.html / react-helmet"],
];

const CMS: [string, string][] = [
  ["@sanity/client", "Sanity"],
  ["next-sanity", "Sanity"],
  ["contentful", "Contentful"],
  ["@strapi/strapi", "Strapi"],
  ["tinacms", "TinaCMS"],
  ["decap-cms-app", "Decap CMS"],
  ["netlify-cms-app", "Netlify CMS"],
  ["@prismicio/client", "Prismic"],
  ["@tryghost/content-api", "Ghost"],
  ["payload", "Payload CMS"],
  ["@builder.io/react", "Builder.io"],
  ["@storyblok/js", "Storyblok"],
  ["@keystatic/core", "Keystatic"],
  ["@directus/sdk", "Directus"],
  ["@shopify/hydrogen", "Shopify Hydrogen"],
];

const DATABASES: [string, string][] = [
  ["@prisma/client", "Prisma"],
  ["drizzle-orm", "Drizzle"],
  ["mongoose", "MongoDB"],
  ["mongodb", "MongoDB"],
  ["pg", "PostgreSQL"],
  ["mysql2", "MySQL"],
  ["better-sqlite3", "SQLite"],
  ["sqlite3", "SQLite"],
  ["@supabase/supabase-js", "Supabase"],
  ["firebase", "Firebase"],
  ["@planetscale/database", "PlanetScale"],
];

export const CONTENT_DIR_CANDIDATES = [
  "src/content/blog",
  "src/content/posts",
  "src/content/articles",
  "content/blog",
  "content/posts",
  "content/articles",
  "content/news",
  "_posts",
  "posts",
  "blog",
  "src/posts",
  "src/blog",
  "data/blog",
  "src/routes/blog",
  "app/blog",
  "pages/blog",
];

export async function detectStack(fs: SafeFs): Promise<StackDetection> {
  const notes: string[] = [];
  const pkgRaw = await fs.readText("package.json");
  let deps: Deps = {};
  let scripts: Record<string, string> = {};
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { dependencies?: Deps; devDependencies?: Deps; scripts?: Record<string, string> };
      deps = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
      scripts = pkg.scripts ?? {};
    } catch {
      notes.push("package.json could not be parsed");
    }
  }

  let framework = "Static HTML";
  let frameworkVersion: string | undefined;
  let output: string[] = [];
  let routing = "file paths";
  let metadata = "static <head> tags";
  for (const [dep, name, out, r, m] of FRAMEWORKS) {
    if (deps[dep]) {
      framework = name;
      frameworkVersion = deps[dep];
      output = out;
      routing = r;
      metadata = m;
      break;
    }
  }
  if (!pkgRaw) {
    if (fs.exists("hugo.toml") || fs.exists("hugo.yaml") || ((await fs.readText("config.toml")) ?? "").includes("baseURL")) {
      framework = "Hugo";
      output = ["public"];
      routing = "content sections";
      metadata = "Hugo templates";
    } else if (fs.exists("_config.yml") && (fs.exists("Gemfile") || fs.exists("_posts") || fs.exists("_layouts"))) {
      framework = "Jekyll";
      output = ["_site"];
      routing = "permalinks";
      metadata = "Jekyll layouts / jekyll-seo-tag";
    } else if (fs.exists("wp-config.php") || fs.exists("wp-content")) {
      framework = "WordPress";
      routing = "WordPress permalinks";
      metadata = "theme / SEO plugin";
      notes.push("WordPress stores content in its database: use the http host adapter against the running site.");
    }
  }

  let buildSystem = "none (files served as-is)";
  if (scripts.build) buildSystem = `npm script "build": ${scripts.build}`;
  else if (framework === "Hugo") buildSystem = "hugo";
  else if (framework === "Jekyll") buildSystem = "jekyll build";
  if (deps.vite && !buildSystem.includes("vite")) buildSystem += " (Vite)";

  const hosting = [
    ["vercel.json", "Vercel"],
    [".vercel", "Vercel"],
    ["netlify.toml", "Netlify"],
    ["_redirects", "Netlify / Cloudflare Pages"],
    ["firebase.json", "Firebase Hosting"],
    ["wrangler.toml", "Cloudflare"],
    ["wrangler.jsonc", "Cloudflare"],
    ["amplify.yml", "AWS Amplify"],
    ["app.yaml", "Google App Engine"],
    ["fly.toml", "Fly.io"],
    ["render.yaml", "Render"],
    ["CNAME", "GitHub Pages"],
    ["Dockerfile", "container (Dockerfile)"],
  ]
    .filter(([f]) => fs.exists(f!))
    .map(([, n]) => n!);

  const cms = [...new Set(CMS.filter(([d]) => deps[d]).map(([, n]) => n))];
  if (fs.exists("public/admin/config.yml") || fs.exists("static/admin/config.yml") || fs.exists("admin/config.yml")) cms.push("Decap/Netlify CMS");
  if (framework === "WordPress") cms.push("WordPress");
  const database = [...new Set(DATABASES.filter(([d]) => deps[d]).map(([, n]) => n))];

  const sitemapGenerator = deps["next-sitemap"]
    ? "next-sitemap"
    : deps["@astrojs/sitemap"]
      ? "@astrojs/sitemap"
      : deps["@nuxtjs/sitemap"] || deps["nuxt-simple-sitemap"]
        ? "@nuxtjs/sitemap"
        : deps["gatsby-plugin-sitemap"]
          ? "gatsby-plugin-sitemap"
          : deps["sitemap"]
            ? "sitemap (npm)"
            : framework === "Hugo"
              ? "Hugo built-in"
              : framework === "Jekyll"
                ? "jekyll-sitemap (if enabled)"
                : "static file or none";

  const outputDirCandidates = [...output, "out", "dist", "build", "_site", "public", "www", "site", "docs", "."].filter((d, i, a) => a.indexOf(d) === i);

  return {
    framework,
    ...(frameworkVersion ? { frameworkVersion } : {}),
    buildSystem,
    routing,
    hosting: hosting.length ? [...new Set(hosting)].join(", ") : "unknown (no hosting config found in the repository)",
    cms: cms.length ? [...new Set(cms)].join(", ") : "none detected",
    database: database.length ? database.join(", ") : "none detected",
    outputDirCandidates,
    contentDirCandidates: CONTENT_DIR_CANDIDATES,
    sitemapGenerator,
    metadata,
    canonical: "per-page <link rel=canonical> (verified per page during inventory)",
    notes,
  };
}

/** Redirects declared in _redirects, netlify.toml and vercel.json (exact paths only). */
export async function readRedirects(fs: SafeFs, outputDir: string | undefined): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const f of ["_redirects", "public/_redirects", outputDir ? `${outputDir}/_redirects` : ""].filter(Boolean)) {
    const t = await fs.readText(f);
    if (!t) continue;
    for (const line of t.split("\n")) {
      const m = /^\s*(\/\S*)\s+(\S+)(?:\s+(30[1278]))?/.exec(line);
      if (m && !m[1]!.includes("*") && !m[1]!.includes(":")) map[m[1]!] = m[2]!;
    }
  }
  const vercel = await fs.readText("vercel.json");
  if (vercel) {
    try {
      const v = JSON.parse(vercel) as { redirects?: { source: string; destination: string }[] };
      for (const r of v.redirects ?? []) if (!/[*:(]/.test(r.source)) map[r.source] = r.destination;
    } catch {
      // ignore malformed vercel.json; the host's own build will report it
    }
  }
  const netlify = await fs.readText("netlify.toml");
  if (netlify) {
    const blocks = netlify.split(/\[\[redirects\]\]/).slice(1);
    for (const b of blocks) {
      const from = /from\s*=\s*"([^"]+)"/.exec(b)?.[1];
      const to = /to\s*=\s*"([^"]+)"/.exec(b)?.[1];
      if (from && to && !/[*:]/.test(from)) map[from] = to;
    }
  }
  return map;
}
