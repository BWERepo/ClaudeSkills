import { checkBwseoCompatibility, emptyInventory, mergeIntoInventory, type BwseoInventory } from "../../adapters/bweseo/bweseo.js";
import type { BlogSeoIndex, IndexArticle } from "../seo/index-builder.js";
import { EngineError } from "../errors.js";
import type { EngineContext, EngineState } from "./context.js";

/**
 * Reports (and, if enabled, writes) how the Blog SEO Index maps onto BWESEO's inventory. Off by default
 * (bweSeoIntegration.syncInventory); when off, this only inspects and reports what it would change.
 */
export async function syncBweseo(ctx: EngineContext, index: BlogSeoIndex): Promise<EngineState["bweseo"]> {
  const { config } = ctx;
  const now = ctx.clock.now().toISOString();
  if (!config.bweSeoIntegration.enabled) return { status: "disabled", detail: "BWESEO integration is disabled in config", at: now };

  const invPath = config.bweSeoIntegration.inventoryPath.replace(/^\/+/, "");
  const raw = await ctx.readFs.readText(invPath);
  if (raw === undefined) {
    return { status: "not-installed", detail: `no BWESEO inventory found at ${config.bweSeoIntegration.inventoryPath}; the Blog Engine runs standalone until BWESEO is installed`, at: now };
  }
  let inventory: BwseoInventory;
  try {
    inventory = JSON.parse(raw) as BwseoInventory;
  } catch {
    return { status: "incompatible", detail: `${config.bweSeoIntegration.inventoryPath} is not valid JSON`, at: now };
  }
  const preErrors = checkBwseoCompatibility(inventory);
  if (preErrors.length) return { status: "incompatible", detail: `existing BWESEO inventory already fails its own validation: ${preErrors[0]}`, at: now };

  const sourceOf = (a: IndexArticle): string | undefined => (a.source === "blog-engine" ? `blog-engine@${a.generatedBy ?? "unknown"}` : undefined);
  const result = mergeIntoInventory(inventory, index, sourceOf);
  if (result.warnings.length) return { status: "incompatible", detail: result.warnings[0]!, at: now };

  if (config.bweSeoIntegration.syncInventory) {
    const fs = ctx.writableFs([require_dirname(invPath)]);
    await fs.writeText(invPath, `${JSON.stringify(result.inventory, null, 2)}\n`, { mode: "replace-with-backup", reason: "sync BWESEO inventory with the Blog SEO Index" });
  }
  return { status: "compatible", detail: `${result.added.length} added, ${result.updated.length} updated, ${result.linked.length} linked, ${result.retired.length} retired (syncInventory: ${config.bweSeoIntegration.syncInventory})`, at: now };
}

function require_dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "." : p.slice(0, i);
}

/** First-run helper: a fresh BWESEO inventory for a project that has the Blog Engine but not BWESEO yet. */
export function bootstrapBwseoInventory(projectId: string): BwseoInventory {
  if (!projectId.trim()) throw new EngineError("BAD_INPUT", "projectId is required");
  return emptyInventory(projectId);
}
