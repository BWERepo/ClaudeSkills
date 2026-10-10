/**
 * The engine's own version. It is independent of any host website and of the BWE SEO Engine's version.
 * Keep in sync with /VERSION and package.json (a unit test enforces this).
 */
export const ENGINE_NAME = "BWE Blog Engine";
export const ENGINE_VERSION = "1.0.0";
/** Shape version of /blog-seo-index.json. Bump the minor for additive fields, the major for breaking changes. */
export const INDEX_SCHEMA_VERSION = "1.0";
/** Shape version of /.well-known/bwe-blog.json. */
export const DISCOVERY_SCHEMA_VERSION = "1.0";
/** Shape version of the engine's own data files (registry, site index, recommendations). */
export const DATA_SCHEMA_VERSION = 1;

export const ENGINE_LABEL = `${ENGINE_NAME} ${ENGINE_VERSION}`;
