# Adapter: Static HTML site

| Concern | Where / how |
|---|---|
| Routes | One `.html` file per page (or folder/`index.html` for clean URLs) |
| Metadata | Each file's `<head>` |
| Shared parts | Includes/partials if a generator is used; otherwise copied header/footer — change all copies consistently |
| Sitemap / robots | Static `sitemap.xml`, `robots.txt` at the web root (or a small generator script) |
| JSON-LD | Inline `<script type="application/ld+json">` per page |
| Rendering | Fully crawlable |
| 404 / redirects | Host config (`.htaccess`, `_redirects`, Worker, etc.) |

## Adding a page
Copy the nearest similar page's structure, replace content, set unique head tags, add to the
sitemap, link from parent pages, check the shared nav/footer.
