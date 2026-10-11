/**
 * One-time tagging job: has a model read each card and write its structured tags to data/tags/tags.jsonl.
 *
 *   pnpm cards:tag --dry-run              show what would be sent and a rough cost, without calling an API
 *   pnpm cards:tag --sample 40 --sync     tag a small spread of cards right away to check quality
 *   pnpm cards:tag                        tag everything still untagged through Claude's Batch API (half price)
 *   pnpm cards:tag --provider deepseek    run the job on DeepSeek instead (it has no batch API, so it runs live)
 *
 * --model picks the model within the provider. --out writes the tags to a different file, so the
 * same sample can be tagged by several models and compared. --limit tags only the next N cards, and
 * --budget stops a live run once it has spent about that many dollars.
 *
 * The most-viewed cards are tagged first, and already-tagged cards are skipped, so the job can be
 * stopped, resumed and re-run after new sets. A batch that is still processing is picked up again
 * on the next run.
 */
import fs from "node:fs";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { hasNoEffectText, type Card } from "../src/lib/card.ts";
import { dropDefaults, fillDefaults, type TaggedCard } from "../src/lib/tags.ts";
import { DEEPSEEK_BASE_URL, PRICES, PROVIDERS, appendJsonl, isDeepSeekPeak, isTransient, priceOf, readJsonl, type Provider, type Reply, type Usage } from "./models.ts";
import { CARDS_PATH, ENV_PATH, TAG_FAILURES_PATH, TAG_INVALID_REPLIES_PATH, TAG_STATE_PATH, TAGS_PATH } from "./paths.ts";
import { parseJsonObject, salvageEntries } from "./reply-parsing.ts";
import { cleanTags, repairEntry } from "./tag-cleanup.ts";
import { TAGGING_EXAMPLES } from "./tagging-examples.ts";
import { buildSystemPrompt, buildUserMessage, TagEntry, tagBatchFormat } from "./tagging-prompt.ts";

const { values: args } = parseArgs({
  options: {
    provider: { type: "string", default: "anthropic" },
    model: { type: "string" },
    effort: { type: "string", default: "low" },
    "per-request": { type: "string", default: "8" },
    sample: { type: "string" },
    limit: { type: "string" },
    ids: { type: "string" },
    sync: { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
    budget: { type: "string" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

if (!(args.provider in PROVIDERS)) {
  console.error(`Unknown --provider "${args.provider}". Use one of: ${Object.keys(PROVIDERS).join(", ")}.`);
  process.exit(1);
}
const provider = args.provider as Provider;
const model = args.model ?? PROVIDERS[provider].defaultModel;
/** --out sends a run to its own file, so several models can tag the same sample for comparison. */
const tagsPath = args.out ?? TAGS_PATH;

const MAX_TOKENS = 20_000;
/** How many requests a live run keeps in flight at once. */
const liveConcurrency = Number(args.concurrency);
/** Live runs retry failed cards, which matters most where the output format is not enforced. */
const LIVE_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 30_000;
const TRUNCATED = "output was cut off; re-run with a smaller --per-request";

const BATCH_DISCOUNT = 0.5;

const budget = args.budget === undefined ? undefined : Number(args.budget);
if (budget !== undefined && (!(budget > 0) || !PRICES[model])) {
  console.error(PRICES[model] ? "--budget must be a dollar amount above 0." : `--budget needs a known price, and "${model}" has none in PRICES.`);
  process.exit(1);
}

interface BatchState {
  batchId: string;
  model: string;
  /** custom_id -> ids of the cards in that request */
  chunks: Record<string, number[]>;
}

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** Half from the most-viewed cards (easy to judge), half spread evenly across everything else. */
function pickSample(cards: Card[], size: number): Card[] {
  const byViews = [...cards].sort((a, b) => b.views - a.views);
  const top = byViews.slice(0, Math.ceil(size / 2));
  const rest = byViews.slice(top.length);
  const step = rest.length / Math.max(1, size - top.length);
  const spread = Array.from({ length: size - top.length }, (_, i) => rest[Math.floor(i * step)]);
  return [...top, ...spread].filter((card) => card !== undefined);
}

// --- Work out what needs tagging -------------------------------------------------------------

const cards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf8")) as Card[];
const cardsById = new Map(cards.map((card) => [card.id, card]));
const tagged = new Set(readJsonl<TaggedCard>(tagsPath).map((row) => row.id));

// The worked examples from the prompt are already tagged by hand.
for (const example of TAGGING_EXAMPLES) {
  const card = cards.find((c) => c.name === example.name);
  if (card && !tagged.has(card.id) && !args["dry-run"]) {
    appendJsonl(tagsPath, { id: card.id, name: card.name, model: "hand-written", tags: cleanTags(card, example.tags) } satisfies TaggedCard);
    tagged.add(card.id);
  }
}
const exampleNames = new Set(TAGGING_EXAMPLES.map((example) => example.name));

// Most-viewed first, so a run that stops early has covered the cards people look up most.
let todo = cards
  .filter((card) => !tagged.has(card.id) && !hasNoEffectText(card) && !exampleNames.has(card.name))
  .sort((a, b) => b.views - a.views);
if (args.ids) {
  const wanted = new Set(args.ids.split(",").map(Number));
  todo = todo.filter((card) => wanted.has(card.id));
}
if (args.sample) todo = pickSample(todo, Number(args.sample));
if (args.limit) todo = todo.slice(0, Number(args.limit));

const perRequest = Number(args["per-request"]);
// Claude is held to the schema by the API. DeepSeek only promises valid JSON, so it is shown the
// schema and may leave empty fields out.
const systemPrompt = buildSystemPrompt(cards, { sparse: provider === "deepseek" });
const chunks = chunk(todo, perRequest);

// --- Talking to each provider -----------------------------------------------------------------

function buildClaudeParams(chunkCards: Card[]): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: MAX_TOKENS,
    // The instructions are identical for every request, so cache them; only the cards vary.
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral", ttl: "1h" } }],
    messages: [{ role: "user", content: buildUserMessage(chunkCards) }],
    output_config: {
      effort: args.effort as NonNullable<Anthropic.OutputConfig["effort"]>,
      format: tagBatchFormat(),
    },
  };
}

function fromClaude(message: Anthropic.Message): Reply {
  const stop = message.stop_reason;
  return {
    text: message.content.find((block) => block.type === "text")?.text,
    problem: stop === "end_turn" ? null : stop === "max_tokens" ? TRUNCATED : `stopped with ${stop}`,
    usage: {
      input: message.usage.input_tokens,
      cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      output: message.usage.output_tokens,
    },
  };
}

async function askDeepSeek(client: OpenAI, chunkCards: Card[]): Promise<Reply> {
  const completion = await client.chat.completions.create({
    model,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildUserMessage(chunkCards) },
    ],
    response_format: { type: "json_object" },
    reasoning_effort: args.effort as OpenAI.ReasoningEffort,
  });
  const choice = completion.choices[0];
  const stop = choice?.finish_reason;
  // DeepSeek reports cached and uncached prompt tokens separately, outside the OpenAI SDK's types.
  const used = completion.usage as (OpenAI.CompletionUsage & { prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number }) | undefined;
  return {
    text: choice?.message.content ?? undefined,
    problem: stop === "stop" ? null : stop === "length" ? TRUNCATED : `stopped with ${stop}`,
    usage: {
      input: used?.prompt_cache_miss_tokens ?? used?.prompt_tokens ?? 0,
      cacheWrite: 0,
      cacheRead: used?.prompt_cache_hit_tokens ?? 0,
      output: used?.completion_tokens ?? 0,
    },
  };
}

function explainApiError(error: unknown): never {
  const { keyVariable } = PROVIDERS[provider];
  if (error instanceof Anthropic.AuthenticationError || error instanceof OpenAI.AuthenticationError) {
    console.error(`The API key was rejected. Check ${keyVariable} in .env.`);
  } else if (error instanceof Anthropic.APIError || error instanceof OpenAI.APIError) {
    console.error(`The ${provider} API returned an error${error.status ? ` (${error.status})` : ""}: ${error.message}`);
  } else if (!process.env[keyVariable]) {
    console.error(`No API key found. Copy .env.example to .env and set ${keyVariable}.`);
  } else {
    throw error;
  }
  process.exit(1);
}

// --- Handling results -------------------------------------------------------------------------

const usage: Usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
let spent = 0;
/** card id -> why it could not be tagged in the latest attempt */
const failures = new Map<number, string>();
let taggedNow = 0;

function fail(ids: number[], reason: string) {
  for (const id of ids) failures.set(id, reason);
  console.warn(`  failed (${ids.length} ${ids.length === 1 ? "card" : "cards"}): ${reason}`);
}

const costOf = (used: Usage) => priceOf(model, used);

function handleReply(reply: Reply, chunkIds: number[], discount = 1) {
  for (const key of Object.keys(usage) as (keyof Usage)[]) usage[key] += reply.usage[key];
  spent += costOf(reply.usage) * discount;

  if (reply.problem) return fail(chunkIds, reply.problem);
  if (!reply.text) return fail(chunkIds, "response contained no text");

  let entries: unknown;
  try {
    entries = (parseJsonObject(reply.text) as { cards?: unknown }).cards;
  } catch {
    entries = salvageEntries(reply.text);
    // Kept so the cause can be diagnosed: this is where a provider's JSON mode shows its gaps.
    appendJsonl(TAG_INVALID_REPLIES_PATH, {
      at: new Date().toISOString(),
      model,
      effort: args.effort,
      ids: chunkIds,
      salvaged: (entries as unknown[]).length,
      text: reply.text,
    });
    console.warn(`  reply was not valid JSON; recovered ${(entries as unknown[]).length} of ${chunkIds.length} cards from it`);
  }
  if (!Array.isArray(entries)) return fail(chunkIds, 'response had no "cards" list');

  const pending = new Set(chunkIds);
  for (const entry of entries as unknown[]) {
    // Validated card by card, so one bad entry does not discard the rest of the request.
    const repaired = repairEntry(fillDefaults(entry));
    const parsed = TagEntry.safeParse(repaired, { reportInput: true });
    if (!parsed.success) {
      const id = (repaired as { id?: unknown }).id;
      const issue = parsed.error.issues[0];
      if (typeof id === "number" && pending.delete(id)) {
        fail([id], `invalid tags at ${issue?.path.join(".")}: got ${JSON.stringify(issue?.input)}`);
      }
      continue;
    }
    const { id, ...tags } = parsed.data;
    const card = cardsById.get(id);
    if (!card || !pending.delete(id)) continue; // not a card we asked about, or a duplicate entry
    appendJsonl(tagsPath, { id, name: card.name, model, effort: args.effort, tags: cleanTags(card, tags) } satisfies TaggedCard);
    taggedNow++;
  }
  if (pending.size === chunkIds.length && !failures.has(chunkIds[0]!)) {
    // Valid JSON that still yielded nothing usable is worth a look, like a reply that would not parse.
    appendJsonl(TAG_INVALID_REPLIES_PATH, { at: new Date().toISOString(), model, effort: args.effort, ids: chunkIds, salvaged: 0, text: reply.text });
  }
  if (pending.size) fail([...pending], "missing from the response");
}

// --- Running ----------------------------------------------------------------------------------

let inFlight = 0;
let completed = 0;
let budgetReached = false;

/** Whether another request may start. Counts what the requests already in flight will cost. */
function hasBudget(): boolean {
  if (budget === undefined || budgetReached) return !budgetReached;
  const typicalRequest = completed ? spent / completed : 0;
  budgetReached = spent + inFlight * typicalRequest >= budget;
  return !budgetReached;
}

async function runLive(ask: (chunkCards: Card[]) => Promise<Reply>) {
  let round = chunks;
  for (let attempt = 1; attempt <= LIVE_ATTEMPTS && round.length && !budgetReached; attempt++) {
    if (attempt > 1) console.log(`Retrying ${failures.size} failed cards (attempt ${attempt} of ${LIVE_ATTEMPTS})...`);
    failures.clear();

    let next = 0;
    const worker = async () => {
      while (next < round.length && hasBudget()) {
        const index = next++;
        const chunkCards = round[index]!;
        const ids = chunkCards.map((card) => card.id);
        inFlight++;
        try {
          handleReply(await ask(chunkCards), ids);
        } catch (error) {
          if (isTransient(error)) fail(ids, "the API was overloaded or unreachable");
          else explainApiError(error);
        } finally {
          inFlight--;
          completed++;
        }
        console.log(`  request ${index + 1}/${round.length} done`);
      }
    };
    await Promise.all(Array.from({ length: liveConcurrency }, worker));

    round = chunk(
      [...failures.keys()].map((id) => cardsById.get(id)!),
      perRequest,
    );
  }
}

async function submitBatch(client: Anthropic): Promise<BatchState> {
  const state: BatchState = { batchId: "", model, chunks: {} };
  const requests = chunks.map((chunkCards, index) => {
    const custom_id = `chunk-${index}`;
    state.chunks[custom_id] = chunkCards.map((card) => card.id);
    return { custom_id, params: buildClaudeParams(chunkCards) };
  });
  const batch = await client.messages.batches.create({ requests }).catch(explainApiError);
  state.batchId = batch.id;
  fs.writeFileSync(TAG_STATE_PATH, JSON.stringify(state));
  console.log(`Submitted batch ${batch.id} (${requests.length} requests, ${todo.length} cards).`);
  return state;
}

async function collectBatch(client: Anthropic, state: BatchState) {
  console.log(`Waiting for batch ${state.batchId}. It is safe to stop this script and re-run it later.`);
  for (;;) {
    const batch = await client.messages.batches.retrieve(state.batchId).catch(explainApiError);
    if (batch.processing_status === "ended") break;
    const { processing, succeeded, errored } = batch.request_counts;
    console.log(`  ${succeeded} done, ${processing} in progress, ${errored} errored`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  for await (const entry of await client.messages.batches.results(state.batchId)) {
    const ids = state.chunks[entry.custom_id] ?? [];
    if (entry.result.type === "succeeded") handleReply(fromClaude(entry.result.message), ids, BATCH_DISCOUNT);
    else fail(ids, `batch request ${entry.result.type}`);
  }
  fs.rmSync(TAG_STATE_PATH);
}

function printDryRun() {
  // ~3.5 characters per token for prose, ~3 for JSON. Good to within a factor of two, no better.
  const systemTokens = systemPrompt.length / 3.5;
  const cardTokens = todo.reduce((sum, card) => sum + buildUserMessage([card]).length, 0) / 3.5;
  const written = (tags: unknown) => JSON.stringify(provider === "deepseek" ? dropDefaults(tags) : tags).length;
  const exampleOutputTokens = TAGGING_EXAMPLES.reduce((sum, example) => sum + written(example.tags), 0) / 3 / TAGGING_EXAMPLES.length;
  const inputTokens = systemTokens * chunks.length + cardTokens;
  const outputTokens = exampleOutputTokens * todo.length;

  console.log(`${todo.length} cards to tag in ${chunks.length} requests (${tagged.size} already tagged).`);
  console.log(`System prompt: ~${Math.round(systemTokens)} tokens. Estimated output: ~${Math.round(exampleOutputTokens)} tokens per card.`);
  console.log("\nRough cost of this run by model, before cache savings and reasoning tokens:");
  for (const [name, price] of Object.entries(PRICES)) {
    // The prompt differs by provider, so only this provider's models can be estimated from it.
    if (price.provider !== provider) continue;
    const list = (inputTokens * price.input + outputTokens * price.output) / 1e6;
    const [cost, basis] =
      price.provider === "anthropic"
        ? [list * BATCH_DISCOUNT, "Batch API price; a --sync run costs double"]
        : [list, "off-peak price; peak hours cost double"];
    console.log(`  ${name.padEnd(18)} ~$${cost.toFixed(2).padStart(6)}  (${basis})`);
  }
  console.log("These are estimates from character counts. Run a --sample first to get real numbers.");
  if (chunks[0]) console.log(`\nFirst request's cards:\n\n${buildUserMessage(chunks[0])}`);
}

function finish() {
  for (const [id, reason] of failures) appendJsonl(TAG_FAILURES_PATH, { id, model, reason });

  const failed = failures.size ? ` (see ${TAG_FAILURES_PATH}; re-run to retry them)` : "";
  console.log(`\nTagged ${taggedNow} cards with ${model}, ${failures.size} failed${failed}.`);
  console.log(
    `Tokens: ${usage.input} input, ${usage.cacheWrite} cache write, ${usage.cacheRead} cache read, ${usage.output} output` +
      (PRICES[model] ? ` — about $${spent.toFixed(2)}.` : "."),
  );
  if (taggedNow) console.log(`Average output per card: ${Math.round(usage.output / taggedNow)} tokens.`);

  const untried = todo.length - taggedNow - failures.size;
  if (budgetReached && untried > 0) {
    console.log(`Stopped at the $${budget} budget with ${untried} cards still untagged. Re-run to continue.`);
  }
}

if (args["dry-run"]) {
  printDryRun();
  process.exit(0);
}

if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);

const pendingBatch = fs.existsSync(TAG_STATE_PATH)
  ? (JSON.parse(fs.readFileSync(TAG_STATE_PATH, "utf8")) as BatchState)
  : null;

if (provider === "deepseek") {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error("No API key found. Copy .env.example to .env and set DEEPSEEK_API_KEY.");
    process.exit(1);
  }
  if (pendingBatch) {
    // Both would tag the same cards, so finish or abandon the batch first.
    console.error(`Claude batch ${pendingBatch.batchId} is still pending. Run "pnpm cards:tag" to collect it, or delete ${TAG_STATE_PATH} to abandon it.`);
    process.exit(1);
  }
  if (todo.length === 0) {
    console.log("Nothing to tag: every card with an effect already has tags.");
  } else {
    const client = new OpenAI({ baseURL: DEEPSEEK_BASE_URL, apiKey, maxRetries: 5 });
    if (isDeepSeekPeak(new Date())) console.log("DeepSeek is in peak hours (weekdays 01:00-04:00 and 06:00-10:00 UTC), so this run costs double.");
    console.log(`Tagging ${todo.length} cards with ${model} in ${chunks.length} requests...`);
    await runLive((chunkCards) => askDeepSeek(client, chunkCards));
    finish();
  }
} else {
  const client = new Anthropic({ maxRetries: 5 });
  if (pendingBatch) {
    console.log(`Resuming batch ${pendingBatch.batchId} from a previous run.`);
    await collectBatch(client, pendingBatch);
    finish();
  } else if (todo.length === 0) {
    console.log("Nothing to tag: every card with an effect already has tags.");
  } else if (args.sync) {
    console.log(`Tagging ${todo.length} cards with ${model} in ${chunks.length} requests...`);
    await runLive(async (chunkCards) => fromClaude(await client.messages.create(buildClaudeParams(chunkCards))));
    finish();
  } else {
    await collectBatch(client, await submitBatch(client));
    finish();
  }
}
