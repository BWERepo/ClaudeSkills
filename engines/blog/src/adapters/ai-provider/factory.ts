import type { AIProviderConfig } from "../../config/config.js";
import { EngineError } from "../../core/errors.js";
import { AnthropicProvider } from "./anthropic.js";
import { DeterministicProvider } from "./deterministic.js";
import { OpenAICompatibleProvider } from "./openai.js";
import type { AIProvider } from "./types.js";

/**
 * Build the configured provider. API keys are read from the environment variable NAMED in config, at call time,
 * server-side only. A missing key is a clear configuration error, never a silent fallback.
 */
export function createProvider(cfg: AIProviderConfig, env: NodeJS.ProcessEnv = process.env): AIProvider {
  const key = (name: string | undefined, fallback: string) => {
    const v = env[name ?? fallback];
    if (!v) throw new EngineError("PROVIDER_NOT_CONFIGURED", `set the ${name ?? fallback} environment variable to use the ${cfg.id} provider`);
    return v;
  };
  switch (cfg.id) {
    case "deterministic":
      return new DeterministicProvider();
    case "anthropic":
      return new AnthropicProvider({
        apiKey: key(cfg.apiKeyEnv, "ANTHROPIC_API_KEY"),
        ...(cfg.model ? { model: cfg.model } : {}),
        ...(cfg.maxTokens ? { maxTokens: cfg.maxTokens } : {}),
        ...(cfg.effort ? { effort: cfg.effort } : {}),
      });
    case "openai":
      if (!cfg.model) throw new EngineError("PROVIDER_NOT_CONFIGURED", "generation.provider.model is required for the openai provider");
      return new OpenAICompatibleProvider({ id: "openai", baseUrl: cfg.baseUrl ?? "https://api.openai.com/v1", apiKey: key(cfg.apiKeyEnv, "OPENAI_API_KEY"), model: cfg.model, ...(cfg.maxTokens ? { maxTokens: cfg.maxTokens } : {}) });
    case "openai-compatible":
      if (!cfg.baseUrl || !cfg.model) throw new EngineError("PROVIDER_NOT_CONFIGURED", "generation.provider.baseUrl and model are required for an openai-compatible (local) provider");
      return new OpenAICompatibleProvider({ id: "openai-compatible", baseUrl: cfg.baseUrl, ...(cfg.apiKeyEnv && env[cfg.apiKeyEnv] ? { apiKey: env[cfg.apiKeyEnv] } : {}), model: cfg.model, ...(cfg.maxTokens ? { maxTokens: cfg.maxTokens } : {}) });
    default:
      throw new EngineError("PROVIDER_NOT_CONFIGURED", `unknown provider ${(cfg as { id: string }).id}`);
  }
}
