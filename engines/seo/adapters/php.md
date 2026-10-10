# Adapter: PHP site (hand-written PHP templates, optionally with a Worker / API alongside)

| Concern | Where / how |
|---|---|
| Routes | `.php` files per page or a front controller with a routes table |
| Metadata | A shared header include taking `$title`, `$description`, `$canonical` variables — find it and pass per-page values; don't hard-code in the include |
| Sitemap | Static `sitemap.xml` or a generator script (check `scripts/` for one) |
| robots.txt | Static file at the web root |
| JSON-LD | In the header include (entity) + per-page blocks |
| Content source | PHP arrays/includes, a database, or JSON files |
| Rendering | Server-rendered — crawlable |
| 404 / redirects | `.htaccess` / host config; ensure 404 pages send a 404 header (`http_response_code(404)`) |

## Adding a page
Create the PHP page using the shared header/footer includes, set per-page meta variables, add
JSON-LD, update the sitemap (or run the generator), link from parent pages, deploy through the
project's existing process (e.g. FTP/CI) only when told to.
