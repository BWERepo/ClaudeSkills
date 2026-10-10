#!/usr/bin/env node
import { loadConfigFile } from "../config/config.js";
import { BlogEngine } from "../core/engine/engine.js";
import { formatProgressLine } from "../core/progress.js";
import { isEngineError } from "../core/errors.js";
import { guideSectionMarkdown, guideSections, loadGuideMarkdown } from "../docs/guide.js";

/**
 * `bwe-blog <command> [args]`. Every long operation prints its progress live; nothing silently hangs.
 */
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const cwd = process.cwd();
  const flags = parseFlags(args);

  switch (command) {
    case "init": {
      const config = await loadConfigFile(String(flags.config ?? cwd));
      console.log(`Initialized ${config.siteRoot} (data in ${config.dataDir}). Edit bwe-blog.config.json to set siteUrl, then run "bwe-blog analyze".`);
      return;
    }
    case "analyze":
    case "reanalyze": {
      const engine = await openEngine(cwd, flags);
      const report = command === "reanalyze" ? await engine.reanalyze() : await engine.analyze();
      console.log(`${report.architecture.framework} detected`);
      console.log(`${report.pagesDiscovered} pages discovered`);
      console.log(`${report.existingArticles} articles found`);
      console.log(`${report.recommendations} article opportunities identified`);
      if (report.changes) {
        console.log(`New pages: ${report.changes.newPages.length}, removed: ${report.changes.removedPages.length}`);
        console.log(`New recommendations: ${report.changes.newRecommendations.length}, obsolete: ${report.changes.obsoleteRecommendations.length}`);
      }
      console.log(report.nextStep);
      return;
    }
    case "recommendations": {
      const engine = await openEngine(cwd, flags);
      const recs = (await engine.recommendations()).filter((r) => r.status === "recommended" || r.status === "selected");
      for (const r of recs) console.log(`${r.id}\t${r.priority}\t${r.recommendedAction}\t${r.title}`);
      console.log(`${recs.length} recommendation(s).`);
      return;
    }
    case "select": {
      const engine = await openEngine(cwd, flags);
      const result = await engine.select(args, String(flags.by ?? "cli"));
      console.log(`Selected ${result.selected.length}. ${result.alreadySelected.length} were already selected.`);
      return;
    }
    case "reject": {
      const engine = await openEngine(cwd, flags);
      const rejected = await engine.reject(args, String(flags.by ?? "cli"), flags.note ? String(flags.note) : undefined);
      console.log(`Rejected ${rejected.length}.`);
      return;
    }
    case "generate": {
      const engine = await openEngine(cwd, flags, true);
      const ids = args.length ? args : (await engine.recommendations()).filter((r) => r.status === "selected").map((r) => r.id);
      if (!ids.length) {
        console.log("Nothing selected. Run \"bwe-blog select <id...>\" first.");
        return;
      }
      const { text } = await engine.buildAndReport(ids, String(flags.by ?? "cli"));
      console.log(text);
      return;
    }
    case "approve": {
      const engine = await openEngine(cwd, flags);
      const a = await engine.approve(required(args[0], "article id"), String(flags.by ?? "cli"));
      console.log(`${a.title}: ${a.status}`);
      return;
    }
    case "publish": {
      const engine = await openEngine(cwd, flags, true);
      const { article, validation } = await engine.publish(required(args[0], "article id"), String(flags.by ?? "cli"));
      console.log(`${article.title}: ${article.status}`);
      for (const i of validation.issues) console.log(`  ${i.severity}: ${i.message}`);
      return;
    }
    case "rebuild-index": {
      const engine = await openEngine(cwd, flags, true);
      const r = await engine.rebuildIndex();
      console.log(`Rebuilt. ${r.indexArticles} articles indexed, ${r.orphans.length} orphans, ${r.brokenLinks} broken links. Sitemap: ${r.sitemap.action}.`);
      return;
    }
    case "links": {
      const engine = await openEngine(cwd, flags);
      const l = await engine.links();
      console.log(`${l.suggestions.length} suggestion(s), ${l.orphans.length} orphan(s), ${l.broken.length} broken.`);
      return;
    }
    case "guide": {
      const sectionArg = args[0] ?? (flags.section ? String(flags.section) : undefined);
      if (!sectionArg) {
        console.log(loadGuideMarkdown());
        return;
      }
      const match = guideSections().find((s) => s.id === sectionArg || s.title.toLowerCase().includes(sectionArg.toLowerCase()));
      if (!match) {
        console.log(`No guide section matches "${sectionArg}". Sections:`);
        for (const s of guideSections()) console.log(`  ${s.id}\t${s.title}`);
        process.exitCode = 1;
        return;
      }
      console.log(guideSectionMarkdown(match.id) ?? "");
      return;
    }
    case "status":
    case "next": {
      const engine = await openEngine(cwd, flags);
      const s = await engine.conductorStatus();
      if (flags.json) {
        console.log(JSON.stringify(s, null, 2));
        return;
      }
      console.log(s.summary);
      if (s.doneSoFar.length) {
        console.log("\nDone so far:");
        for (const d of s.doneSoFar) console.log(`  - ${d}`);
      }
      console.log(`\nNext: ${s.nextAction.description}`);
      console.log(`  ${s.nextAction.command}`);
      if (s.nextAction.guideSection) console.log(`  Guide: bwe-blog guide ${s.nextAction.guideSection.id}  (${s.nextAction.guideSection.title})`);
      if (s.alsoConsider.length) {
        console.log("\nAlso worth a look:");
        for (const a of s.alsoConsider) console.log(`  - ${a.description} (${a.command})`);
      }
      return;
    }
    case "report": {
      const engine = await openEngine(cwd, flags);
      const state = await engine.state();
      console.log(JSON.stringify(state, null, 2));
      return;
    }
    case "admin": {
      const { startAdminServer } = await import("../admin/server.js");
      const engine = await openEngine(cwd, flags, true);
      await startAdminServer(engine);
      return;
    }
    default:
      printHelp();
      if (command && command !== "help" && command !== "--help") process.exitCode = 1;
  }
}

function required(v: string | undefined, name: string): string {
  if (!v) throw new Error(`missing required argument: ${name}`);
  return v;
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = args.length - 1; i >= 0; i--) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      out[k!] = v ?? true;
      args.splice(i, 1);
    }
  }
  return out;
}

async function openEngine(cwd: string, flags: Record<string, string | boolean>, withProgress = false): Promise<BlogEngine> {
  const config = await loadConfigFile(String(flags.config ?? cwd));
  return BlogEngine.create(config, withProgress ? { onProgress: (u) => process.stdout.write(formatProgressLine(u)) } : {});
}

function printHelp(): void {
  console.log(`bwe-blog <command> [args] [--flags]

  guide [section]              Print the install/usage guide, or one section (id or title match)
  init                         Create a config file for the current directory
  analyze                      Inventory the site, find gaps, recommend articles (stops before generating)
  reanalyze                    Re-run analysis and report what changed
  status                        What has been done so far and the next recommended action (--json for machine-readable)
  recommendations               List open recommendations
  select <id...>                Select recommendations for generation (max configured limit)
  reject <id...> [--note=]      Reject recommendations
  generate [id...]              Generate selected (or given) recommendations, link, validate, publish/review
  approve <articleId>           Approve a draft (Mode A)
  publish <articleId>           Run the validation gate and publish
  rebuild-index                 Rebuild the Blog SEO Index without regenerating content
  links                         Summarize link suggestions, orphans and broken links
  report                        Print the engine's persisted state
  admin                         Start the admin dashboard server

Flags: --config=<path> --by=<name>`);
}

main().catch((e) => {
  if (isEngineError(e)) console.error(`Error [${e.code}]: ${e.message}`);
  else console.error(`Error: ${(e as Error).message}`);
  process.exitCode = 1;
});
