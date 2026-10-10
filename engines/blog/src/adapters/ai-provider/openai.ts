import { EngineError } from "../../core/errors.js";
import type { AIProvider, GenerateRequest, GenerateResult } from "./types.js";

export interface OpenAICompatibleOptions {
  id: "openai" | "openai-compatible";
  baseUrl: string;
  apiKey?: string;
  model: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * OpenAI Chat Completions, or any server that implements the same endpoint (local models such as
 * Ollama, LM Studio, vLLM, llama.cpp server).
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string;
  readonly model: string;

  constructor(private readonly opts: OpenAICompatibleOptions) {
    this.id = opts.id;
    this.model = opts.model;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const f = this.opts.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 600_000);
    try {
      const res = await f(`${this.opts.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}) },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens ?? this.opts.maxTokens ?? 16000,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.prompt },
          ],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; model?: string; error?: { message?: string }; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      if (!res.ok) throw new EngineError("PROVIDER_ERROR", `${this.id} API error ${res.status}: ${body.error?.message ?? res.statusText}`);
      const choice = body.choices?.[0];
      if (!choice?.message?.content) throw new EngineError("PROVIDER_ERROR", `${this.id} returned no content`);
      if (choice.finish_reason === "length") throw new EngineError("PROVIDER_ERROR", "the response was cut off; raise generation.provider.maxTokens");
      return { text: choice.message.content, model: body.model ?? this.model, usage: { inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens } };
    } catch (e) {
      if (e instanceof EngineError) throw e;
      throw new EngineError("PROVIDER_ERROR", `${this.id} request failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(t);
    }
  }
}
