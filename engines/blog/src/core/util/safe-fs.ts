import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, rename, writeFile, copyFile, appendFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { EngineError } from "../errors.js";
import { sha256 } from "./hash.js";
import type { Clock } from "./time.js";

export interface BackupRecord {
  id: string;
  at: string;
  file: string;
  backup: string;
  reason: string;
  hash: string;
}

export type WriteMode =
  /** Fail if the file exists. */
  | "create"
  /** Replace only when the current on-disk hash equals `expectedHash` (the engine's own last write). */
  | "replace-owned"
  /** Replace after taking a backup. Used for files the engine shares with the host (sitemaps, the index). */
  | "replace-with-backup"
  /** Engine-owned state inside the data directory (registry, recommendations): atomic replace, no backup copy. */
  | "engine-data";

/**
 * All engine writes go through here. Guarantees:
 *  - paths are confined to the site root and to an explicit allowlist of directories (no traversal, no symlink escape);
 *  - writes are atomic (temp file + rename);
 *  - an existing file is never replaced without either proving the engine wrote it or taking a backup;
 *  - there is no delete operation: archiving moves files and keeps a backup record.
 */
export class SafeFs {
  readonly root: string;
  private readonly allowed: string[];
  private readonly backupDir: string;
  private readonly dataDir: string;

  constructor(
    root: string,
    allowedDirs: string[],
    dataDir: string,
    private readonly clock: Clock,
  ) {
    this.root = realpathOrSelf(path.resolve(root));
    this.dataDir = this.resolveInsideRoot(dataDir);
    this.allowed = [this.dataDir, ...allowedDirs.map((d) => this.resolveInsideRoot(d))];
    this.backupDir = path.join(this.dataDir, "backups");
  }

  get dataRoot(): string {
    return this.rel(this.dataDir);
  }

  /** Resolve a site-root-relative path, refusing anything outside the root. */
  resolveInsideRoot(rel: string): string {
    if (typeof rel !== "string" || rel.includes("\0")) throw new EngineError("UNSAFE_PATH", "invalid path");
    const abs = path.resolve(this.root, rel.replace(/^\/+/, ""));
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) throw new EngineError("UNSAFE_PATH", `path escapes the site root: ${rel}`);
    // Symlink escape: check the deepest existing ancestor's real path.
    let probe = abs;
    while (!existsSync(probe) && probe !== this.root) probe = path.dirname(probe);
    const real = realpathOrSelf(probe);
    if (real !== this.root && !real.startsWith(this.root + path.sep)) throw new EngineError("UNSAFE_PATH", `path resolves outside the site root via a symlink: ${rel}`);
    return abs;
  }

  /** Resolve for writing: must also be inside one of the allowed directories. */
  resolveWritable(rel: string): string {
    const abs = this.resolveInsideRoot(rel);
    if (!this.allowed.some((d) => abs === d || abs.startsWith(d + path.sep))) {
      throw new EngineError("UNSAFE_PATH", `the engine is not allowed to write ${this.rel(abs)} (outside its configured output directories)`);
    }
    if (/(^|[\\/])\.(git|env)([\\/]|$)/.test(this.rel(abs)) || /\.env(\.|$)/.test(path.basename(abs))) {
      throw new EngineError("UNSAFE_PATH", `refusing to write a protected path: ${this.rel(abs)}`);
    }
    return abs;
  }

  rel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join("/");
  }

  exists(rel: string): boolean {
    return existsSync(this.resolveInsideRoot(rel));
  }

  async readText(rel: string): Promise<string | undefined> {
    const abs = this.resolveInsideRoot(rel);
    if (!existsSync(abs)) return undefined;
    return readFile(abs, "utf8");
  }

  async hashOf(rel: string): Promise<string | undefined> {
    const t = await this.readText(rel);
    return t === undefined ? undefined : sha256(t);
  }

  /** Write a file atomically. Returns the new content hash and any backup taken. */
  async writeText(rel: string, content: string, opts: { mode: WriteMode; expectedHash?: string; reason: string }): Promise<{ hash: string; backup?: BackupRecord; unchanged: boolean }> {
    const abs = this.resolveWritable(rel);
    if (opts.mode === "engine-data" && !(abs.startsWith(this.dataDir + path.sep))) throw new EngineError("UNSAFE_PATH", `engine-data writes must stay inside the data directory: ${rel}`);
    const newHash = sha256(content);
    let backup: BackupRecord | undefined;
    if (existsSync(abs)) {
      const current = await readFile(abs, "utf8");
      const curHash = sha256(current);
      if (curHash === newHash) return { hash: newHash, unchanged: true };
      if (opts.mode === "engine-data") {
        // engine-owned state: no backup copy
      } else if (opts.mode === "create") throw new EngineError("OVERWRITE_REFUSED", `${this.rel(abs)} already exists; the engine never overwrites existing content`);
      if (opts.mode === "replace-owned" && curHash !== opts.expectedHash) {
        throw new EngineError(
          "OVERWRITE_REFUSED",
          `${this.rel(abs)} was changed outside the engine since it was last written; refusing to overwrite hand-edited content`,
        );
      }
      if (opts.mode !== "engine-data") backup = await this.backup(abs, opts.reason, curHash);
    }
    await mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.bwe-tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, abs);
    return { hash: newHash, backup, unchanged: false };
  }

  /** Move a file (archive). Takes a backup first; never deletes. */
  async move(fromRel: string, toRel: string, reason: string): Promise<BackupRecord> {
    const from = this.resolveWritable(fromRel);
    const to = this.resolveWritable(toRel);
    if (!existsSync(from)) throw new EngineError("NOT_FOUND", `${fromRel} does not exist`);
    if (existsSync(to)) throw new EngineError("OVERWRITE_REFUSED", `${toRel} already exists`);
    const content = await readFile(from);
    const rec = await this.backup(from, reason, sha256(content));
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
    return rec;
  }

  private async backup(abs: string, reason: string, hash: string): Promise<BackupRecord> {
    const at = this.clock.now().toISOString();
    const id = `${at.replace(/[-:.TZ]/g, "")}-${hash.slice(0, 8)}`;
    const relFile = this.rel(abs);
    const dest = path.join(this.backupDir, id, relFile);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(abs, dest);
    const rec: BackupRecord = { id, at, file: relFile, backup: this.rel(dest), reason, hash };
    await mkdir(this.backupDir, { recursive: true });
    await appendFile(path.join(this.backupDir, "index.jsonl"), `${JSON.stringify(rec)}\n`, "utf8");
    return rec;
  }

  async listBackups(): Promise<BackupRecord[]> {
    const idx = path.join(this.backupDir, "index.jsonl");
    if (!existsSync(idx)) return [];
    return (await readFile(idx, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as BackupRecord);
  }

  /** Restore a file from a backup (the current version is itself backed up first). */
  async restore(backupId: string, file?: string): Promise<BackupRecord[]> {
    const recs = (await this.listBackups()).filter((r) => r.id === backupId && (!file || r.file === file));
    if (!recs.length) throw new EngineError("NOT_FOUND", `no backup ${backupId}`);
    for (const r of recs) {
      const content = await readFile(this.resolveInsideRoot(r.backup), "utf8");
      await this.writeText(r.file, content, { mode: "replace-with-backup", reason: `restore ${backupId}` });
    }
    return recs;
  }

  async listFiles(relDir: string, filter: (rel: string) => boolean, maxDepth = 12): Promise<string[]> {
    const start = this.resolveInsideRoot(relDir);
    if (!existsSync(start)) return [];
    const out: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".bwe-tmp")) continue;
        const abs = path.join(dir, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) await walk(abs, depth + 1);
        else if (e.isFile()) {
          const rel = this.rel(abs);
          if (filter(rel)) out.push(rel);
        }
      }
    };
    await walk(start, 0);
    return out.sort();
  }

  async mtime(rel: string): Promise<string | undefined> {
    const abs = this.resolveInsideRoot(rel);
    if (!existsSync(abs)) return undefined;
    return (await stat(abs)).mtime.toISOString();
  }
}

function realpathOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
