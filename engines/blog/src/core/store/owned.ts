import type { JsonStore } from "./store.js";

/**
 * Files the engine wrote, with the hash of what it wrote. A file is the engine's to replace only while its
 * on-disk hash still matches; once a person edits it, the engine leaves it alone.
 */
export class OwnedFiles {
  private map: Record<string, string> = {};
  constructor(private readonly store: JsonStore) {}

  async load(): Promise<this> {
    this.map = await this.store.read<Record<string, string>>("owned-files.json", {});
    return this;
  }
  hashOf(rel: string): string | undefined {
    return this.map[rel];
  }
  owns(rel: string): boolean {
    return rel in this.map;
  }
  set(rel: string, hash: string): void {
    this.map[rel] = hash;
  }
  release(rel: string): void {
    delete this.map[rel];
  }
  async save(): Promise<void> {
    await this.store.write("owned-files.json", this.map);
  }
}
