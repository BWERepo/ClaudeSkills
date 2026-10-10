import type { ArticleBrief } from "../../core/generator/brief.js";

export interface GenerateRequest {
  purpose: "article" | "ideas";
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Structured brief. Real providers use `prompt`; the deterministic provider builds from this. */
  brief?: ArticleBrief;
}

export interface GenerateResult {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Any text-generation backend. Article records never depend on which provider produced them beyond the
 * informational `generatedBy` field.
 */
export interface AIProvider {
  readonly id: string;
  readonly model: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}
