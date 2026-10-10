export interface ProgressUpdate {
  operation: string;
  step: string;
  status: "running" | "complete" | "warning" | "failed";
  message: string;
  /** Optional counter, e.g. pages discovered so far. */
  count?: number;
  total?: number;
  at: string;
}

export type ProgressListener = (u: ProgressUpdate) => void;

/**
 * Long operations report every step so a user never wonders whether the process stalled.
 * The CLI prints these lines; the admin dashboard streams them over Server-Sent Events.
 */
export class Progress {
  private log: ProgressUpdate[] = [];
  constructor(
    readonly operation: string,
    private readonly listener?: ProgressListener,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(step: string, message: string): void {
    this.push({ step, status: "running", message });
  }
  done(step: string, message = "Complete", count?: number): void {
    this.push({ step, status: "complete", message, ...(count !== undefined ? { count } : {}) });
  }
  warn(step: string, message: string): void {
    this.push({ step, status: "warning", message });
  }
  fail(step: string, message: string): void {
    this.push({ step, status: "failed", message });
  }
  tick(step: string, message: string, count: number, total?: number): void {
    this.push({ step, status: "running", message, count, ...(total !== undefined ? { total } : {}) });
  }

  get entries(): readonly ProgressUpdate[] {
    return this.log;
  }

  private push(u: Omit<ProgressUpdate, "operation" | "at">): void {
    const full: ProgressUpdate = { operation: this.operation, at: this.now().toISOString(), ...u };
    this.log.push(full);
    this.listener?.(full);
  }
}

/** Formats progress for a terminal: "Analyzing website...\n147 pages discovered". */
export function formatProgressLine(u: ProgressUpdate): string {
  if (u.status === "running") return u.count !== undefined ? `  ${u.message}` : `${u.message}...`;
  if (u.status === "complete") return u.message === "Complete" ? "Complete\n" : `${u.message}\n`;
  if (u.status === "warning") return `Warning: ${u.message}`;
  return `FAILED: ${u.message}`;
}
