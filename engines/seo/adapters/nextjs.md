# Adapter: Next.js

| Concern | App Router | Pages Router |
|---|---|---|
| Routes | `app/<segment>/page.tsx` | `pages/<name>.tsx` |
| Metadata | `export const metadata` / `generateMetadata()` (title, description, `alternates.canonical`, `openGraph`, `robots`) | `next/head` in the page |
| Sitemap | `app/sitemap.ts` | `public/sitemap.xml` or `next-sitemap` if already installed |
| robots | `app/robots.ts` | `public/robots.txt` |
| JSON-LD | `<script type="application/ld+json" dangerouslySetInnerHTML=…>` in the page | same |
| Rendering | Server Components / SSG — crawlable; avoid `"use client"` for primary content fetched only on the client | `getStaticProps`/`getServerSideProps` |
| 404 | `not-found.tsx` / `notFound()` | `pages/404.tsx` |
| Redirects | `next.config` `redirects()` (permanent: true → 308) or middleware | same |

## Adding a page
Follow the existing segment/layout conventions, set metadata, add to the sitemap source, link from
parent pages, run `next build`.
