import path from "node:path";
import { createProvider } from "../../adapters/ai-provider/factory.js";
import type { AIProvider } from "../../adapters/ai-provider/types.js";
import { FileSystemHostAdapter } from "../../adapters/host-site/filesystem.js";
import { HttpHostAdapter } from "../../adapters/host-site/http.js";
import type { HostSiteAdapter } from "../../adapters/host-site/types.js";
import type { BlogEngineConfig } from "../../config/config.js";
import { EngineError } from "../errors.js";
import { EventBus } from "../events.js";
import { Progress, type ProgressListener } from "../progress.js";
import { ArticleRegistry } from "../registry/registry.js";
import { OwnedFiles } from "../store/owned.js";
import { JsonStore } from "../store/store.js";
import type { AnalysisResult, BrokenLink, LinkSuggestion, Recommendation, SitePage, TopicCluster } from "../types.js";
import { SafeFs } from "../util/safe-fs.js";
import { systemClock, type Clock } from "../util/time.js";

export interface EngineOptions {
  host?: HostSiteAdapter;
  provider?: AIProvider;
  clock?: Clock;
  onProgress?: ProgressListener;
  env?: NodeJS.ProcessEnv;
}

export interface EngineState {
  lastAnalysisAt?: string;
  lastRebuildAt?: string;
  lastIndexValidation?: { passed: boolean; errors: string[]; at: string };
  bweseo?: { status: "compatible" | "not-installed" | "incompatible" | "disabled"; detail: string; at: string };
  blogIndexPage?: "engine" | "host" | "none";
  sitemapMode?: string;
}

export type StoredAnalysis = Omit<AnalysisResult, "pages" | "existingArticles"> & { linkProblems: { fromUrl: string; href: string; problems: string[] }[] };

export interface LinksState {
  suggestions: LinkSuggestion[];
  broken: BrokenLink[];
  orphans: string[];
  weaklyLinked: string[];
  updatedAt?: string;
}

/**
 * Shared wiring for every engine operation: configuration, safe file access, persistent stores, the registry,
 * events, and the host adapter.
 */
export class EngineContext {
  readonly clock: Clock;
  readonly store: JsonStore;
  readonly events: EventBus;
  readonly registry: ArticleRegistry;
  readonly owned: OwnedFiles;
  readonly host: HostSiteAdapter;
  readonly readFs: SafeFs;
  private providerInstance?: AIProvider;

  constructor(
    readonly config: BlogEngineConfig,
    readonly opts: EngineOptions = {},
  ) {
    this.clock = opts.clock ?? systemClock;
    this.readFs = new SafeFs(config.siteRoot, [], config.dataDir, this.clock);
    this.store = new JsonStore(this.readFs);
    this.events = new EventBus(this.clock, (e) => this.store.appendLine("events.jsonl", e));
    this.registry = new ArticleRegistry(this.store, this.events, this.clock);
    this.owned = new OwnedFiles(this.store);
    this.host = opts.host ?? defaultHost(config, this.readFs);
  }

  async init(): Promise<this> {
    await this.registry.load();
    await this.owned.load();
    return this;
  }

  progress(operation: string): Progress {
    return new Progress(operation, this.opts.onProgress, () => this.clock.now());
  }

  get provider(): AIProvider {
    return (this.providerInstance ??= this.opts.provider ?? createProvider(this.config.generation.provider, this.opts.env ?? process.env));
  }

  /** File access allowed to write only to the directories the engine manages on this host. */
  writableFs(dirs: string[]): SafeFs {
    return new SafeFs(this.config.siteRoot, dirs, this.config.dataDir, this.clock);
  }

  // ---- persisted state -------------------------------------------------------------------------------------
  readSiteIndex = () => this.store.read<SitePage[]>("site-index.json", []);
  writeSiteIndex = (p: SitePage[]) => this.store.write("site-index.json", p);
  readAnalysis = () => this.store.read<StoredAnalysis | null>("analysis.json", null);
  writeAnalysis = (a: StoredAnalysis) => this.store.write("analysis.json", a);
  readRecommendations = () => this.store.read<Recommendation[]>("recommendations.json", []);
  writeRecommendations = (r: Recommendation[]) => this.store.write("recommendations.json", r);
  readClusters = () => this.store.read<TopicCluster[]>("clusters.json", []);
  writeClusters = (c: TopicCluster[]) => this.store.write("clusters.json", c);
  readLinks = () => this.store.read<LinksState>("links.json", { suggestions: [], broken: [], orphans: [], weaklyLinked: [] });
  writeLinks = (l: LinksState) => this.store.write("links.json", l);
  readState = () => this.store.read<EngineState>("state.json", {});
  async patchState(p: Partial<EngineState>): Promise<EngineState> {
    const s = { ...(await this.readState()), ...p };
    await this.store.write("state.json", s);
    return s;
  }

  draftPath(articleId: string): string {
    if (!/^[a-z0-9-]+$/.test(articleId)) throw new EngineError("UNSAFE_PATH", "bad article id");
    return path.posix.join(this.readFs.dataRoot, "drafts", `${articleId}.md`);
  }

  async readDraft(articleId: string): Promise<string | undefined> {
    return this.readFs.readText(this.draftPath(articleId));
  }

  async writeDraft(articleId: string, markdown: string): Promise<void> {
    await this.readFs.writeText(this.draftPath(articleId), markdown, { mode: "engine-data", reason: "draft" });
  }

  async flush(): Promise<void> {
    await this.registry.save();
    await this.owned.save();
    await this.events.flush();
  }
}

function defaultHost(config: BlogEngineConfig, fs: SafeFs): HostSiteAdapter {
  if (config.host.adapter === "http") return new HttpHostAdapter(config);
  return new FileSystemHostAdapter(fs, config);
}
