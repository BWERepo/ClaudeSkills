import path from "node:path";
import { DATA_SCHEMA_VERSION } from "../../version.js";
import { EngineError } from "../errors.js";
import type { SafeFs } from "../util/safe-fs.js";

/**
 * JSON documents in the engine's data directory. Each file is wrapped in { schemaVersion, data } so a
 * future engine version can migrate it.
 */
export class JsonStore {
  constructor(private readonly fs: SafeFs) {}

  private file(name: string): string {
    if (!/^[a-z0-9][a-z0-9._/-]*\.json$/i.test(name) || name.includes("..")) throw new EngineError("UNSAFE_PATH", `bad store name ${name}`);
    return path.posix.join(this.fs.dataRoot, name);
  }

  async read<T>(name: string, fallback: T): Promise<T> {
    const raw = await this.fs.readText(this.file(name));
    if (raw === undefined) return fallback;
    let parsed: { schemaVersion?: number; data?: T };
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new EngineError("HOST_ERROR", `engine data file ${name} is not valid JSON (${(e as Error).message}); restore it from ${this.fs.dataRoot}/backups or git`);
    }
    if (parsed.schemaVersion !== undefined && parsed.schemaVersion > DATA_SCHEMA_VERSION) {
      throw new EngineError("HOST_ERROR", `${name} was written by a newer engine (data schema ${parsed.schemaVersion}); upgrade the engine`);
    }
    return (parsed.data ?? fallback) as T;
  }

  async write<T>(name: string, data: T): Promise<void> {
    await this.fs.writeText(this.file(name), `${JSON.stringify({ schemaVersion: DATA_SCHEMA_VERSION, data }, null, 2)}\n`, { mode: "engine-data", reason: `update ${name}` });
  }

  async appendLine(name: string, line: unknown): Promise<void> {
    const f = this.file(name.replace(/\.jsonl$/, ".json")).replace(/\.json$/, ".jsonl");
    const cur = (await this.fs.readText(f)) ?? "";
    // Keep the log bounded: the newest 5,000 events.
    const lines = cur.split("\n").filter(Boolean);
    lines.push(JSON.stringify(line));
    const kept = lines.slice(-5000);
    await this.fs.writeText(f, `${kept.join("\n")}\n`, { mode: "engine-data", reason: "event log" });
  }

  async readLines<T>(name: string): Promise<T[]> {
    const f = this.file(name.replace(/\.jsonl$/, ".json")).replace(/\.json$/, ".jsonl");
    const raw = (await this.fs.readText(f)) ?? "";
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as T);
  }
}
