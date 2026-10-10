import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig, type BlogEngineConfigInput } from "../../src/config/config.js";
import { BlogEngine } from "../../src/core/engine/engine.js";
import { fixedClock } from "../../src/core/util/time.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.resolve(__dirname, "../fixtures/sites");

/** Copies a fixture site into an isolated temp directory so tests never mutate the checked-in fixture. */
export function copyFixture(name: string): string {
  const dest = mkdtempSync(path.join(tmpdir(), `bwe-blog-${name}-`));
  cpSync(path.join(FIXTURES, name), dest, { recursive: true });
  return dest;
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** A fully-wired engine over a copied fixture: fixed clock, deterministic provider, drafts publishable. */
export async function openTestEngine(siteRoot: string, overrides: BlogEngineConfigInput = {}, at = "2024-06-01T00:00:00.000Z"): Promise<BlogEngine> {
  const config = resolveConfig(
    {
      siteUrl: overrides.siteUrl ?? "https://www.sunrisedental.example",
      siteRoot,
      generation: { provider: { id: "deterministic" }, publishDeterministicDrafts: true, ...overrides.generation },
      ...overrides,
    },
    { siteRoot },
  );
  return BlogEngine.create(config, { clock: fixedClock(at) });
}
