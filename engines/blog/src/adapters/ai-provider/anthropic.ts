import Anthropic from "@anthropic-ai/sdk";
import { EngineError } from "../../core/errors.js";
import type { AIProvider, GenerateRequest, GenerateResult } from "./types.js";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  client?: Anthropic;
}

/** Claude via the official Anthropic SDK. Streams long generations and opts into server-side refusal fallbacks. */
export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(private readonly opts: AnthropicProviderOptions) {
    this.model = opts.model ?? "claude-opus-5-5";
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    try {
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: req.maxTokens ?? this.opts.maxTokens ?? 32000,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        output_config: { effort: this.opts.effort ?? "high" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as unknown as Parameters<Anthropic["beta"]["messages"]["stream"]>[0]);
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") throw new EngineError("PROVIDER_REFUSED", "the model declined this request");
      const text = msg.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (msg.stop_reason === "max_tokens") throw new EngineError("PROVIDER_ERROR", "the response was cut off at max_tokens; raise generation.provider.maxTokens");
      return { text, model: msg.model, usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens } };
    } catch (e) {
      if (e instanceof EngineError) throw e;
      if (e instanceof Anthropic.APIError) throw new EngineError("PROVIDER_ERROR", `Anthropic API error ${e.status ?? ""}: ${e.message}`.trim());
      throw new EngineError("PROVIDER_ERROR", `Anthropic request failed: ${(e as Error).message}`);
    }
  }
}
