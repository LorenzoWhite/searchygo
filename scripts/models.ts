/** What the tagging and synergy jobs share about the model providers: their names, prices and replies. */
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const PROVIDERS = {
  anthropic: { defaultModel: "claude-opus-5-5", keyVariable: "ANTHROPIC_API_KEY" },
  // DeepSeek speaks the OpenAI chat-completions protocol.
  deepseek: { defaultModel: "deepseek-flash", keyVariable: "DEEPSEEK_API_KEY" },
  // OpenCode Go: one subscription for several open models. The ones listed below speak the OpenAI
  // chat-completions protocol, like DeepSeek. Usage counts against a monthly allowance per model,
  // valued at the prices below, of which at most a fifth can go in any 5 hours.
  opencode: { defaultModel: "deepseek-v4-pro", keyVariable: "OPENCODE_API_KEY" },
} as const;
export type Provider = keyof typeof PROVIDERS;

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const OPENCODE_BASE_URL = "https://opencode.ai/inference/go/v1";
/**
 * OpenCode asks programs calling Go directly to name themselves rather than send a library's name,
 * and to keep one session id for a run of related requests.
 */
export const OPENCODE_USER_AGENT = "searchygo-tagger/1.0 (+https://searchygo.com)";

/**
 * USD per million tokens, used for cost figures and --budget. Claude rows are list prices (the Batch
 * API halves them); DeepSeek rows are its off-peak prices (peak hours cost double). OpenCode rows
 * are keyed "<model>@opencode" (see priceKey), since some of its models share a name with DeepSeek's.
 */
export const PRICES: Record<string, { provider: Provider; input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { provider: "anthropic", input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { provider: "anthropic", input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { provider: "anthropic", input: 0.1, output: 0.5, cacheRead: 0.01 },
  "deepseek-v4-pro": { provider: "deepseek", input: 0.66, output: 1.98, cacheRead: 0.022 },
  "deepseek-flash": { provider: "deepseek", input: 0.15, output: 0.6, cacheRead: 0.003 },
  "deepseek-v4-pro@opencode": { provider: "opencode", input: 0.66, output: 1.98, cacheRead: 0.022 },
  "glm-5.3@opencode": { provider: "opencode", input: 1.4, output: 4.4, cacheRead: 0.26 },
  "mimo-v2.6-pro@opencode": { provider: "opencode", input: 0.435, output: 0.87, cacheRead: 0.003625 },
};

/** The PRICES row for a model as reached through a provider. */
export const priceKey = (provider: Provider, model: string) => (provider === "opencode" ? `${model}@opencode` : model);
/** Claude bills a 1-hour cache write at twice the input price. */
export const CACHE_WRITE_MULTIPLIER = 2;

/** DeepSeek doubles its prices on weekdays from 01:00 to 04:00 and 06:00 to 10:00 UTC. */
export function isDeepSeekPeak(at: Date): boolean {
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
}

export interface Usage {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

/** A model's answer to one request, in a shape both providers map onto. */
export interface Reply {
  text: string | undefined;
  /** Null when the model finished normally, otherwise why the output cannot be used. */
  problem: string | null;
  usage: Usage;
}

/** What a request cost at the model's listed price, doubled during DeepSeek's peak hours. `model` is a PRICES key. */
export function priceOf(model: string, used: Usage, at = new Date()): number {
  const price = PRICES[model];
  if (!price) return 0;
  const list =
    ((used.input + used.cacheWrite * CACHE_WRITE_MULTIPLIER) * price.input + used.cacheRead * price.cacheRead + used.output * price.output) / 1e6;
  // DeepSeek's models cost double at peak wherever they are reached from.
  return model.startsWith("deepseek") && isDeepSeekPeak(at) ? list * 2 : list;
}

export const isTransient = (error: unknown) =>
  error instanceof Anthropic.RateLimitError ||
  error instanceof Anthropic.InternalServerError ||
  error instanceof Anthropic.APIConnectionError ||
  error instanceof OpenAI.RateLimitError ||
  error instanceof OpenAI.InternalServerError ||
  error instanceof OpenAI.APIConnectionError;

export const readJsonl = <T>(file: string): T[] =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T)
    : [];

export const appendJsonl = (file: string, row: unknown) => fs.appendFileSync(file, JSON.stringify(row) + "\n");
