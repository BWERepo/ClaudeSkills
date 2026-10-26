// BWESEO local persistence helpers for the CLIs (Node only — never imported by Worker code).
//
// Contract: a JSON file is replaced atomically (temp file in the same folder, flushed, then renamed over the target), so a crash,
// a full disk or a killed process leaves either the old file or the new one — never a half-written file. A leftover temp file from an
// interrupted write is ignored and cleaned up on the next write. Reading a file that exists but is not valid JSON is an ERROR that
// names the file; it is never treated as "empty", so a later save cannot silently wipe it.
// Serialization: withFileLock() lets cooperating BWESEO processes on ONE machine take turns on a file (exclusive-create lock file
// with owner and age; a lock left by a dead process or older than `staleMs` is taken over). It does not coordinate network file
// systems or other tools that write the file.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const tmpName = (path) => join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

export function writeFileAtomic(path, text, { fs = {} } = {}) {
  const { openSync: open = openSync, writeSync: write = writeSync, fsyncSync: sync = fsyncSync, closeSync: close = closeSync, renameSync: rename = renameSync, unlinkSync: unlink = unlinkSync } = fs;
  mkdirSync(dirname(path), { recursive: true });
  cleanStaleTemps(path);
  const tmp = tmpName(path);
  let fd;
  try {
    fd = open(tmp, "wx");
    write(fd, text);
    sync(fd);
    close(fd); fd = undefined;
    rename(tmp, path);
  } catch (e) {
    if (fd !== undefined) { try { close(fd); } catch { /* already closed */ } }
    try { unlink(tmp); } catch { /* nothing to remove */ }
    throw e;
  }
}
export const writeJsonAtomic = (path, value, opts) => writeFileAtomic(path, JSON.stringify(value, null, 2) + "\n", opts);

// Missing file -> fallback. Present but unreadable/invalid -> throws (the file is left untouched).
export function readJsonStrict(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (e) {
    throw new Error(`${path} exists but is not valid JSON (${e.message}). It was not changed; fix or restore it, then run again.`);
  }
}

// Remove temp files left by an interrupted write of THIS file (older than a minute, so a concurrent writer's live temp is kept).
export function cleanStaleTemps(path, { olderThanMs = 60_000, now = Date.now() } = {}) {
  const dir = dirname(path); const prefix = `.${basename(path)}.tmp-`;
  let removed = 0;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.startsWith(prefix)) continue;
      try { if (now - statSync(join(dir, f)).mtimeMs > olderThanMs) { unlinkSync(join(dir, f)); removed += 1; } } catch { /* raced with its owner */ }
    }
  } catch { /* folder not readable: nothing to clean */ }
  return removed;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

// Run fn() while holding `${path}.lock`. Throws an Error with code "BUSY" when another live process holds it.
export async function withFileLock(path, fn, { staleMs = 5 * 60_000, now = () => Date.now() } = {}) {
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const owner = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const take = () => { const fd = openSync(lock, "wx"); writeSync(fd, JSON.stringify({ pid: process.pid, owner, at: now() })); closeSync(fd); };
  try { take(); } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let held = null; try { held = JSON.parse(readFileSync(lock, "utf8")); } catch { /* unreadable lock counts as stale */ }
    const stale = !held || now() - Number(held.at) > staleMs || (held.pid && !alive(held.pid));
    if (!stale) throw Object.assign(new Error(`${basename(path)} is being updated by another BWESEO process (started ${new Date(Number(held.at)).toISOString()}). Try again in a moment.`), { code: "BUSY" });
    try { unlinkSync(lock); } catch { /* someone else took it over */ }
    try { take(); } catch (e2) { if (e2.code === "EEXIST") throw Object.assign(new Error(`${basename(path)} is being updated by another BWESEO process.`), { code: "BUSY" }); throw e2; }
  }
  try { return await fn(); } finally {
    try { if (JSON.parse(readFileSync(lock, "utf8")).owner === owner) unlinkSync(lock); } catch { /* already gone */ }
  }
}
