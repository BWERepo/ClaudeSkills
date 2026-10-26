import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic, writeFileAtomic, readJsonStrict, withFileLock, cleanStaleTemps } from "./safe-write.mjs";
import { main, statePath, loadState } from "./seo-landing.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "safe-write-"));

describe("atomic JSON writes", () => {
  it("replaces the file and leaves no temp files", () => {
    const d = dir(); const f = join(d, "a", "state.json");
    writeJsonAtomic(f, { v: 1 }); writeJsonAtomic(f, { v: 2 });
    expect(JSON.parse(readFileSync(f, "utf8"))).toEqual({ v: 2 });
    expect(readdirSync(join(d, "a"))).toEqual(["state.json"]);
  });
  it.each(["write", "fsync", "rename"])("an interrupted write (%s fails) keeps the previous file intact and removes the temp file", (stage) => {
    const d = dir(); const f = join(d, "state.json");
    writeJsonAtomic(f, { v: 1 });
    const boom = () => { throw new Error("disk full"); };
    const fs = stage === "write" ? { writeSync: boom } : stage === "fsync" ? { fsyncSync: boom } : { renameSync: boom };
    expect(() => writeFileAtomic(f, '{"v":2}', { fs })).toThrow(/disk full/);
    expect(JSON.parse(readFileSync(f, "utf8"))).toEqual({ v: 1 });
    expect(readdirSync(d)).toEqual(["state.json"]);
  });
  it("a crash that leaves a temp file behind does not affect the real file, and the next write cleans it up", () => {
    const d = dir(); const f = join(d, "state.json");
    writeJsonAtomic(f, { v: 1 });
    const leftover = join(d, ".state.json.tmp-999-abc-def"); writeFileSync(leftover, '{"v":');
    const old = new Date(Date.now() - 3_600_000); utimesSync(leftover, old, old);
    expect(readJsonStrict(f, null)).toEqual({ v: 1 });
    writeJsonAtomic(f, { v: 3 });
    expect(existsSync(leftover)).toBe(false);
  });
  it("keeps a very recent temp file (a live writer's) when cleaning", () => {
    const d = dir(); const f = join(d, "state.json"); const live = join(d, ".state.json.tmp-1-a-b"); writeFileSync(live, "x");
    expect(cleanStaleTemps(f)).toBe(0); expect(existsSync(live)).toBe(true);
  });
  it("refuses to treat a corrupt file as empty", () => {
    const d = dir(); const f = join(d, "state.json"); writeFileSync(f, '{"v":');
    expect(() => readJsonStrict(f, {})).toThrow(/not valid JSON.*not changed/);
    expect(readJsonStrict(join(d, "missing.json"), { d: 1 })).toEqual({ d: 1 });
  });
});

describe("file lock", () => {
  it("serializes: a second holder is refused while the first runs, then allowed", async () => {
    const d = dir(); const f = join(d, "state.json");
    let inner;
    await withFileLock(f, async () => { inner = await withFileLock(f, async () => 1).catch((e) => e); });
    expect(inner).toMatchObject({ code: "BUSY" });
    expect(await withFileLock(f, async () => 2)).toBe(2);
    expect(existsSync(`${f}.lock`)).toBe(false);
  });
  it("releases on error", async () => {
    const f = join(dir(), "state.json");
    await expect(withFileLock(f, async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(existsSync(`${f}.lock`)).toBe(false);
  });
  it("takes over a lock left by a dead process or an old one", async () => {
    const f = join(dir(), "state.json");
    writeFileSync(`${f}.lock`, JSON.stringify({ pid: 2 ** 22 + 12345, owner: "dead", at: Date.now() }));
    expect(await withFileLock(f, async () => "ok")).toBe("ok");
    writeFileSync(`${f}.lock`, JSON.stringify({ pid: process.pid, owner: "old", at: Date.now() - 3_600_000 }));
    expect(await withFileLock(f, async () => "ok2")).toBe("ok2");
    writeFileSync(`${f}.lock`, "garbage");
    expect(await withFileLock(f, async () => "ok3")).toBe("ok3");
  });
});

describe("landing CLI under concurrency", () => {
  it("two simultaneous mutating commands never lose an update", async () => {
    const cwd = dir();
    const quiet = { cwd, out: () => {} };
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => main(["add", `service number ${i} words`], quiet)));
    const state = loadState(cwd);
    const ok = rs.filter((c) => c === 0).length;
    expect(state.keywords).toHaveLength(ok); // every command that said "done" is in the file
    expect(ok).toBeGreaterThanOrEqual(1);
    expect(existsSync(`${statePath(cwd)}.lock`)).toBe(false);
  });
  it("a corrupt state file stops the command without overwriting it", async () => {
    const cwd = dir(); const lines = [];
    await main(["add", "custom websites"], { cwd, out: () => {} });
    writeFileSync(statePath(cwd), "{ not json");
    await expect(main(["add", "other thing"], { cwd, out: (l) => lines.push(l) })).rejects.toThrow(/not valid JSON/);
    expect(readFileSync(statePath(cwd), "utf8")).toBe("{ not json");
  });
});
