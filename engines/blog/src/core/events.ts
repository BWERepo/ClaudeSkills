import type { EngineEvent, EngineEventName } from "./types.js";
import type { Clock } from "./util/time.js";

export type EventListener = (e: EngineEvent) => void | Promise<void>;

/**
 * In-process event bus. Every event is also handed to `sink` (the engine persists them to events.jsonl),
 * so integrations such as the BWESEO adapter can replay what changed since they last looked.
 */
export class EventBus {
  private listeners = new Map<EngineEventName | "*", Set<EventListener>>();
  private pending: Promise<unknown>[] = [];
  // The sink appends to one file; writes run one after another so no event is lost to a concurrent write.
  private sinkChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly clock: Clock,
    private readonly sink?: (e: EngineEvent) => Promise<void>,
  ) {}

  on(name: EngineEventName | "*", fn: EventListener): () => void {
    const set = this.listeners.get(name) ?? new Set();
    set.add(fn);
    this.listeners.set(name, set);
    return () => set.delete(fn);
  }

  emit<T>(name: EngineEventName, data?: T, articleId?: string): EngineEvent<T> {
    const e: EngineEvent<T> = { name, at: this.clock.now().toISOString(), ...(articleId ? { articleId } : {}), ...(data !== undefined ? { data } : {}) };
    for (const fn of [...(this.listeners.get(name) ?? []), ...(this.listeners.get("*") ?? [])]) {
      try {
        const r = fn(e);
        if (r instanceof Promise) this.pending.push(r.catch(() => undefined));
      } catch {
        // A listener failing must never break the engine operation that emitted the event.
      }
    }
    if (this.sink) {
      const sink = this.sink;
      this.sinkChain = this.sinkChain.then(() => sink(e)).catch(() => undefined);
      this.pending.push(this.sinkChain);
    }
    return e;
  }

  /** Wait for async listeners and the sink. Called at the end of every engine operation. */
  async flush(): Promise<void> {
    const p = this.pending;
    this.pending = [];
    await Promise.all(p);
  }
}
