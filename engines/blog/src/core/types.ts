/**
 * Normalized data model shared by every engine module and adapter.
 * Nothing in here is specific to a website, framework, CMS or AI provider.
 */

export const ARTICLE_STATUSES = [
  "recommended",
  "selected",
  "generating",
  "draft",
  "review",
  "approved",
  "published",
  "rejected",
  "archived",
  "error",
] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export type ArticleSource = "existing" | "blog-engine";

export const SEARCH_INTENTS = ["informational", "commercial", "transactional", "navigational", "mixed"] as const;
export type SearchIntent = (typeof SEARCH_INTENTS)[number];

export type Priority = "Critical" | "High" | "Medium" | "Low";
export type RecommendedAction = "Create" | "Consider" | "Skip" | "Consolidate With Existing Content";

export interface Heading {
  level: number;
  text: string;
}

export interface LinkRef {
  /** Absolute URL after normalization (same-origin links are absolute on the site origin). */
  href: string;
  anchor: string;
  /** Where the link sits: body copy, navigation, footer, header. Only "body" links count as contextual. */
  context: "body" | "nav" | "header" | "footer";
}

export const PAGE_TYPES = [
  "home",
  "product",
  "service",
  "category",
  "tool",
  "calculator",
  "informational",
  "location",
  "faq",
  "comparison",
  "guide",
  "resource",
  "landing",
  "about",
  "contact",
  "legal",
  "blog-index",
  "blog-category",
  "blog-article",
  "utility",
  "other",
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/** Page types whose copy is commercial or transactional; the engine never edits them without explicit opt-in. */
export const PROTECTED_PAGE_TYPES: readonly PageType[] = [
  "home",
  "product",
  "service",
  "category",
  "landing",
  "tool",
  "calculator",
  "contact",
  "legal",
];

/** One indexable page of the host website, normalized. */
export interface SitePage {
  id: string;
  url: string;
  path: string;
  title: string;
  description: string;
  h1: string;
  headings: Heading[];
  pageType: PageType;
  canonicalUrl: string;
  indexable: boolean;
  robots: string;
  schemaTypes: string[];
  internalLinksOut: LinkRef[];
  externalLinks: LinkRef[];
  wordCount: number;
  keyTerms: string[];
  faqQuestions: string[];
  /** 0..1 importance estimate (page type, inbound links, nav placement). */
  importance: number;
  isBlogArticle: boolean;
  sourceFile?: string;
  lastModified?: string;
  contentHash: string;
  /** Plain-text excerpt (bounded) used for similarity; never sent anywhere without being marked untrusted. */
  excerpt: string;
}

export interface StatusChange {
  from: ArticleStatus | null;
  to: ArticleStatus;
  at: string;
  by: string;
  note?: string;
}

export interface StorageRef {
  adapter: string;
  /** Path relative to the host site root, when file-backed. */
  path?: string;
  /** Record id, when database/CMS-backed. */
  recordId?: string;
}

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface ValidationResult {
  passed: boolean;
  checkedAt: string;
  issues: ValidationIssue[];
}

export interface BlogArticle {
  id: string;
  title: string;
  slug: string;
  url: string;
  source: ArticleSource;
  status: ArticleStatus;
  description: string;
  primaryTopic: string;
  secondaryTopics: string[];
  category: string;
  tags: string[];
  searchIntent: SearchIntent;
  author?: string;
  publishedAt?: string;
  modifiedAt?: string;
  canonicalUrl: string;
  clusterId?: string;
  pillarArticle?: string;
  internalLinksIn: string[];
  internalLinksOut: string[];
  outboundLinks: string[];
  relatedArticles: string[];
  relatedSitePages: string[];
  schemaTypes: string[];
  indexable: boolean;
  generatedBy?: string;
  engineVersion?: string;
  lastAnalyzedAt?: string;

  headings: Heading[];
  wordCount: number;
  image?: string;
  /** Indexing status reported by the host (robots meta, X-Robots-Tag), when known. */
  indexingStatus?: string;
  contentHash?: string;
  metadataHash?: string;
  lastIndexedAt?: string;
  lastReviewedAt?: string;
  lastModifiedAt?: string;
  refreshRecommended?: boolean;
  refreshReason?: string[];
  orphan?: boolean;
  storage?: StorageRef;
  recommendationId?: string;
  validation?: ValidationResult;
  history: StatusChange[];
  /** Hash of the file as the engine last wrote it; a different on-disk hash means a human edited it. */
  writtenHash?: string;
  error?: string;
}

export interface Recommendation {
  id: string;
  title: string;
  proposedSlug: string;
  primaryTopic: string;
  primarySearchIntent: SearchIntent;
  contentType: ContentType;
  targetAudience: string;
  suggestedCategory: string;
  suggestedTags: string[];
  primaryPagesSupported: string[];
  reason: string;
  contentGap: string;
  internalLinkOpportunities: string[];
  relatedExistingArticles: string[];
  potentialCannibalization: CannibalizationFinding[];
  priority: Priority;
  opportunitySource: string;
  recommendedAction: RecommendedAction;
  /** Never a number unless a real data source supplied it. */
  searchVolume: "Unknown" | { value: number; source: string; retrievedAt: string };
  keywordDifficulty: "Unknown" | { value: number; source: string; retrievedAt: string };
  clusterId?: string;
  clusterRole?: "pillar" | "supporting";
  status: "recommended" | "selected" | "rejected" | "created" | "obsolete";
  score: number;
  createdAt: string;
  updatedAt: string;
  /** Free-text editor notes added through Edit Recommendation. */
  notes?: string;
  editedBy?: string;
}

export type ContentType =
  | "guide"
  | "how-to"
  | "explainer"
  | "comparison"
  | "checklist"
  | "faq"
  | "cost-guide"
  | "case-for"
  | "troubleshooting"
  | "glossary";

export interface CannibalizationFinding {
  url: string;
  title: string;
  kind: "existing-article" | "site-page" | "recommendation";
  similarity: number;
  sameIntent: boolean;
  decision: "do-not-create" | "expand-existing" | "consolidate" | "differentiate" | "supporting-subtopic";
  note: string;
}

export interface TopicCluster {
  id: string;
  name: string;
  pillar?: string;
  supportingArticles: string[];
  relatedSitePages: string[];
  faqContent: string[];
  comparisonContent: string[];
  complete: boolean;
  gaps: string[];
}

export interface LinkSuggestion {
  id: string;
  fromUrl: string;
  toUrl: string;
  anchor: string;
  score: number;
  band: "excellent" | "strong" | "optional" | "below-threshold";
  direction: "blog-to-blog" | "blog-to-site" | "site-to-blog";
  reasons: string[];
  /** The sentence the anchor was found in, when the anchor already exists in the source text. */
  context?: string;
  status: "suggested" | "applied" | "rejected" | "needs-review";
}

export interface BrokenLink {
  fromUrl: string;
  href: string;
  problem:
    | "not-found"
    | "redirect"
    | "malformed"
    | "wrong-protocol"
    | "staging-host"
    | "localhost"
    | "duplicate-canonical-path"
    | "unpublished-target";
  detail: string;
}

export interface SiteArchitecture {
  framework: string;
  frameworkVersion?: string;
  buildSystem: string;
  routing: string;
  hosting: string;
  cms: string;
  database: string;
  contentStorage: "html-files" | "markdown" | "mdx" | "cms" | "database" | "remote" | "mixed" | "unknown";
  blog: {
    exists: boolean;
    root?: string;
    urlPattern?: string;
    contentDir?: string;
    frontmatterKeys: string[];
    articleCount: number;
  };
  templates: string[];
  metadata: string;
  sitemap: { paths: string[]; kind: "single" | "index" | "none"; generatedBy: string };
  robots: { path?: string; disallow: string[]; sitemaps: string[] };
  canonical: string;
  structuredData: string[];
  navigation: string[];
  categories: string[];
  tags: string[];
  authors: string[];
  redirects: Record<string, string>;
  internalLinkPatterns: string;
  seoInfrastructure: string[];
  outputDir?: string;
  notes: string[];
}

export interface SiteProfile {
  siteUrl: string;
  name: string;
  primarySubject: string;
  secondarySubjects: string[];
  offerings: { name: string; kind: "product" | "service" | "tool"; url: string }[];
  targetAudience: string;
  geographicMarket: string;
  entities: string[];
  topics: { term: string; weight: number; pages: string[] }[];
  contentDepth: { pages: number; articles: number; averageWords: number };
  orphanPages: string[];
  weaklyLinkedPages: string[];
  notes: string[];
}

export interface AnalysisResult {
  analyzedAt: string;
  architecture: SiteArchitecture;
  profile: SiteProfile;
  pages: SitePage[];
  existingArticles: BlogArticle[];
  gaps: ContentGap[];
}

export interface ContentGap {
  id: string;
  topic: string;
  kind:
    | "unsupported-offering"
    | "unanswered-question"
    | "thin-cluster"
    | "missing-comparison"
    | "missing-how-to"
    | "missing-explainer"
    | "missing-pillar";
  supportsPages: string[];
  evidence: string;
  weight: number;
}

export type EngineEventName =
  | "article.discovered"
  | "article.created"
  | "article.updated"
  | "article.published"
  | "article.unpublished"
  | "article.archived"
  | "article.deleted"
  | "links.updated"
  | "index.rebuilt"
  | "recommendations.updated"
  | "analysis.completed";

export interface EngineEvent<T = unknown> {
  name: EngineEventName;
  at: string;
  articleId?: string;
  data?: T;
}
