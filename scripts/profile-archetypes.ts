/**
 * One-time synergy job: has a model read each archetype's cards and write down which kinds of
 * outside card work with it, to data/synergy/profiles.jsonl. The search then answers "synergy with
 * <archetype>" from those profiles without calling a model.
 *
 *   pnpm cards:synergy --dry-run                         show what would be sent and a rough cost, without calling an API
 *   pnpm cards:synergy --provider deepseek --sample 12   profile a few archetypes right away to check quality
 *   pnpm cards:synergy --provider deepseek --only "Clown Crew,True Draco"
 *   pnpm cards:synergy --provider deepseek               profile everything not yet profiled
 *
 * --model picks the model within the provider and --effort how hard it reasons. --out writes to a
 * different file, so the same archetypes can be profiled by several models and compared. --limit
 * profiles only the next N archetypes, and --budget stops once about that many dollars are spent.
 * --redo profiles the chosen archetypes again, replacing what is stored.
 *
 * Every reply is kept as the model wrote it in data/synergy/replies.jsonl. --reread rebuilds the
 * profiles from those replies without calling an API, for when the rules for reading a reply change.
 *
 * The most-viewed archetypes come first and profiled ones are skipped, so the job can be stopped,
 * resumed, and re-run after new sets.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Card } from "../src/lib/card.ts";
import { findPartners, readProfile, type ArchetypeProfile, type Candidate, type ProfiledArchetype } from "../src/lib/synergy.ts";
import type { TaggedCard } from "../src/lib/tags.ts";
import { DEEPSEEK_BASE_URL, PRICES, PROVIDERS, appendJsonl, isDeepSeekPeak, isTransient, priceOf, readJsonl, type Provider, type Reply, type Usage } from "./models.ts";
import { CARDS_PATH, ENV_PATH, SYNERGY_FAILURES_PATH, SYNERGY_PATH, SYNERGY_REPLIES_PATH, TAGS_PATH } from "./paths.ts";
import { parseJsonObject } from "./reply-parsing.ts";
import { MAX_CARDS_SHOWN, SYNERGY_EXAMPLES, buildSynergyPrompt, profileFormat, renderArchetype } from "./synergy-prompt.ts";

const { values: args } = parseArgs({
  options: {
    provider: { type: "string", default: "anthropic" },
    model: { type: "string" },
    effort: { type: "string", default: "low" },
    sample: { type: "string" },
    limit: { type: "string" },
    only: { type: "string" },
    redo: { type: "boolean", default: false },
    reread: { type: "boolean", default: false },
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
const profilesPath = args.out ?? SYNERGY_PATH;

/** An archetype with fewer cards than this is a pair of cards, not a deck with a plan. */
const MIN_CARDS = 3;
/**
 * Room for the profile itself and for the reasoning a model does before writing it. A model that
 * reasons spends far more on that than on the profile: about 7,000 tokens an archetype at low effort.
 */
const MAX_TOKENS = 24_000;
const ATTEMPTS = 3;
/** Runs of up to this many archetypes print each profile in full, for reading by eye. */
const SHOWN_IN_FULL = 25;

const budget = args.budget === undefined ? undefined : Number(args.budget);
if (budget !== undefined && (!(budget > 0) || !PRICES[model])) {
  console.error(PRICES[model] ? "--budget must be a dollar amount above 0." : `--budget needs a known price, and "${model}" has none in PRICES.`);
  process.exit(1);
}

// --- Work out what needs profiling ------------------------------------------------------------

interface Archetype {
  name: string;
  cards: Card[];
  views: number;
}

const cards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf8")) as Card[];
const grouped = new Map<string, Card[]>();
for (const card of cards) {
  if (card.archetype) grouped.set(card.archetype, [...(grouped.get(card.archetype) ?? []), card]);
}
// Most-viewed first, so a run that stops early has covered the decks people look up most.
const archetypes: Archetype[] = [...grouped]
  .filter(([, members]) => members.length >= MIN_CARDS)
  .map(([name, members]) => ({ name, cards: members, views: members.reduce((sum, card) => sum + card.views, 0) }))
  .sort((a, b) => b.views - a.views);
const byName = new Map(archetypes.map((archetype) => [archetype.name.toLowerCase(), archetype]));

const stored = readJsonl<ProfiledArchetype>(profilesPath);
const profiled = new Set(stored.map((row) => row.archetype));

// The worked examples from the prompt are already profiled by hand.
for (const example of SYNERGY_EXAMPLES) {
  const archetype = byName.get(example.archetype.toLowerCase());
  if (archetype && !profiled.has(archetype.name) && !args["dry-run"]) {
    fs.mkdirSync(path.dirname(profilesPath), { recursive: true });
    appendJsonl(profilesPath, { archetype: archetype.name, cards: archetype.cards.length, model: "hand-written", profile: example.profile } satisfies ProfiledArchetype);
    profiled.add(archetype.name);
  }
}
const exampleNames = new Set(SYNERGY_EXAMPLES.map((example) => example.archetype.toLowerCase()));

/** Half from the most-viewed archetypes (easy to judge), half spread evenly across the rest. */
function pickSample(from: Archetype[], size: number): Archetype[] {
  const top = from.slice(0, Math.ceil(size / 2));
  const rest = from.slice(top.length);
  const step = rest.length / Math.max(1, size - top.length);
  const spread = Array.from({ length: size - top.length }, (_, i) => rest[Math.floor(i * step)]);
  return [...top, ...spread].filter((archetype) => archetype !== undefined);
}

let todo = archetypes.filter((archetype) => !exampleNames.has(archetype.name.toLowerCase()));
if (args.only) {
  const wanted = args.only.split(",").map((name) => name.trim().toLowerCase());
  const unknown = wanted.filter((name) => !byName.has(name));
  if (unknown.length) {
    console.error(`No archetype with ${MIN_CARDS} or more cards is called: ${unknown.join(", ")}.`);
    process.exit(1);
  }
  todo = todo.filter((archetype) => wanted.includes(archetype.name.toLowerCase()));
}
if (!args.redo) todo = todo.filter((archetype) => !profiled.has(archetype.name));
if (args.sample) todo = pickSample(todo, Number(args.sample));
if (args.limit) todo = todo.slice(0, Number(args.limit));

const systemPrompt = buildSynergyPrompt();

// --- Talking to each provider -----------------------------------------------------------------

const TRUNCATED = "output was cut off before the profile was finished";

async function askClaude(client: Anthropic, message: string): Promise<Reply> {
  const reply = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    // The instructions are identical for every request, so cache them; only the archetype varies.
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral", ttl: "1h" } }],
    messages: [{ role: "user", content: message }],
    output_config: { effort: args.effort as NonNullable<Anthropic.OutputConfig["effort"]>, format: profileFormat() },
  });
  const stop = reply.stop_reason;
  return {
    text: reply.content.find((block) => block.type === "text")?.text,
    problem: stop === "end_turn" ? null : stop === "max_tokens" ? TRUNCATED : `stopped with ${stop}`,
    usage: {
      input: reply.usage.input_tokens,
      cacheWrite: reply.usage.cache_creation_input_tokens ?? 0,
      cacheRead: reply.usage.cache_read_input_tokens ?? 0,
      output: reply.usage.output_tokens,
    },
  };
}

async function askDeepSeek(client: OpenAI, message: string): Promise<Reply> {
  const completion = await client.chat.completions.create({
    model,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: message },
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
/** archetype -> why it could not be profiled in the latest attempt */
const failures = new Map<string, string>();
const written = new Map<string, ArchetypeProfile>();

function fail(name: string, reason: string) {
  failures.set(name, reason);
  console.warn(`  failed (${name}): ${reason}`);
}

function handleReply(reply: Reply, archetype: Archetype) {
  for (const key of Object.keys(usage) as (keyof Usage)[]) usage[key] += reply.usage[key];
  spent += priceOf(model, reply.usage);

  if (reply.problem) return fail(archetype.name, reply.problem);
  if (!reply.text) return fail(archetype.name, "response contained no text");

  let parsed: unknown;
  try {
    parsed = parseJsonObject(reply.text);
  } catch {
    return fail(archetype.name, "response was not valid JSON");
  }
  const read = readProfile(parsed, archetype.name);
  if (!read) return fail(archetype.name, "response had no plan or no usable hook");
  for (const reason of read.dropped) console.warn(`  ${archetype.name}: left out ${reason}`);
  appendJsonl(SYNERGY_REPLIES_PATH, { archetype: archetype.name, model, effort: args.effort, reply: parsed } satisfies StoredReply);

  appendJsonl(profilesPath, { archetype: archetype.name, cards: archetype.cards.length, model, effort: args.effort, profile: read.profile } satisfies ProfiledArchetype);
  written.set(archetype.name, read.profile);
}

/** A line of data/synergy/replies.jsonl: what the model wrote, before any of it was left out. */
interface StoredReply {
  archetype: string;
  model: string;
  effort?: string;
  reply: unknown;
}

/** Rebuilds stored profiles from the replies they came from. The latest reply for an archetype wins. */
function reread() {
  const latest = new Map(readJsonl<StoredReply>(SYNERGY_REPLIES_PATH).map((row) => [row.archetype, row]));
  let rebuilt = 0;
  const rows = readJsonl<ProfiledArchetype>(profilesPath).map((row) => {
    const kept = latest.get(row.archetype);
    const read = kept && readProfile(kept.reply, row.archetype);
    if (!kept || !read) return row;
    rebuilt++;
    return { ...row, model: kept.model, effort: kept.effort, profile: read.profile };
  });
  fs.writeFileSync(profilesPath, rows.map((row) => JSON.stringify(row) + "\n").join(""));
  console.log(`Rebuilt ${rebuilt} of ${rows.length} profiles from stored replies. The rest have no stored reply and were left as they are.`);
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

async function run(ask: (message: string) => Promise<Reply>) {
  let round = todo;
  for (let attempt = 1; attempt <= ATTEMPTS && round.length && !budgetReached; attempt++) {
    if (attempt > 1) console.log(`Retrying ${failures.size} failed archetypes (attempt ${attempt} of ${ATTEMPTS})...`);
    failures.clear();

    let next = 0;
    const worker = async () => {
      while (next < round.length && hasBudget()) {
        const index = next++;
        const archetype = round[index]!;
        inFlight++;
        try {
          handleReply(await ask(renderArchetype(archetype.name, archetype.cards)), archetype);
        } catch (error) {
          if (isTransient(error)) fail(archetype.name, "the API was overloaded or unreachable");
          else explainApiError(error);
        } finally {
          inFlight--;
          completed++;
        }
        console.log(`  ${index + 1}/${round.length} ${archetype.name}`);
      }
    };
    await Promise.all(Array.from({ length: Number(args.concurrency) }, worker));
    round = round.filter((archetype) => failures.has(archetype.name));
  }
}

/** Prints a profile with what each hook finds, so its quality can be judged by eye. */
function show(name: string, profile: ArchetypeProfile, candidates: Candidate[]) {
  const { hooks, partners } = findPartners(profile, name, candidates);
  const names = (indexes: number[]) => indexes.map((index) => candidates[index]!.card.name).join(", ");
  console.log(`\n${name}\n  ${profile.plan}`);
  hooks.forEach(({ hook, matches, ignored }, at) => {
    const examples = partners.filter((partner) => partner.fits.includes(at)).slice(0, 4);
    console.log(`  - ${hook.label}: ${matches} cards${ignored ? " (too common to mean anything; not used)" : ""}${matches === 0 ? " (finds nothing)" : ""}`);
    console.log(`      ${hook.why}`);
    if (examples.length) console.log(`      e.g. ${names(examples.map((partner) => partner.index))}`);
  });
  console.log(`  Top of ${partners.length} partners: ${names(partners.slice(0, 10).map((partner) => partner.index)) || "none"}`);
}

function printDryRun() {
  // ~3.5 characters per token for prose, ~3 for JSON. Good to within a factor of two, no better.
  const systemTokens = systemPrompt.length / 3.5;
  const archetypeTokens = todo.reduce((sum, archetype) => sum + renderArchetype(archetype.name, archetype.cards).length, 0) / 3.5;
  const outputTokens = (SYNERGY_EXAMPLES.reduce((sum, example) => sum + JSON.stringify(example.profile).length, 0) / 3 / SYNERGY_EXAMPLES.length) * todo.length;

  console.log(`${todo.length} archetypes to profile (${profiled.size} already profiled; ${archetypes.length} have ${MIN_CARDS} or more cards).`);
  console.log(`Instructions: ~${Math.round(systemTokens)} tokens, repeated on every request. Archetype cards: ~${Math.round(archetypeTokens)} tokens in all.`);
  console.log(`Archetypes with more than ${MAX_CARDS_SHOWN} cards are shown by their ${MAX_CARDS_SHOWN} best-known.`);
  console.log("\nRough cost of this run by model, before cache savings and reasoning tokens:");
  for (const [name, price] of Object.entries(PRICES)) {
    if (price.provider !== provider) continue;
    const cost = ((systemTokens * todo.length + archetypeTokens) * price.input + outputTokens * price.output) / 1e6;
    console.log(`  ${name.padEnd(18)} ~$${cost.toFixed(2).padStart(6)}${price.provider === "deepseek" ? "  (off-peak price; peak hours cost double)" : ""}`);
  }
  console.log("These are estimates from character counts, and reasoning can add several times the output. Run a --sample first to get real numbers.");
  if (todo[0]) console.log(`\nFirst request (${todo[0].name}) begins:\n\n${renderArchetype(todo[0].name, todo[0].cards).slice(0, 900)}…`);
}

function finish() {
  for (const [archetype, reason] of failures) appendJsonl(SYNERGY_FAILURES_PATH, { archetype, model, reason });

  if (written.size && written.size <= SHOWN_IN_FULL) {
    const tags = new Map(readJsonl<TaggedCard>(TAGS_PATH).map((row) => [row.id, row.tags]));
    const candidates = cards.map((card) => ({ card, tags: tags.get(card.id) }));
    for (const [name, profile] of written) show(name, profile, candidates);
  }

  const failed = failures.size ? ` (see ${SYNERGY_FAILURES_PATH}; re-run to retry them)` : "";
  console.log(`\nProfiled ${written.size} archetypes with ${model}, ${failures.size} failed${failed}.`);
  console.log(
    `Tokens: ${usage.input} input, ${usage.cacheWrite} cache write, ${usage.cacheRead} cache read, ${usage.output} output` +
      (PRICES[model] ? ` — about $${spent.toFixed(2)}.` : "."),
  );
  if (written.size) console.log(`Average output per archetype: ${Math.round(usage.output / completed)} tokens.`);

  const untried = todo.length - written.size - failures.size;
  if (budgetReached && untried > 0) console.log(`Stopped at the $${budget} budget with ${untried} archetypes still to do. Re-run to continue.`);
}

if (args["dry-run"]) {
  printDryRun();
  process.exit(0);
}

if (args.reread) {
  reread();
  process.exit(0);
}

if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
const apiKey = process.env[PROVIDERS[provider].keyVariable];
if (!apiKey) {
  console.error(`No API key found. Copy .env.example to .env and set ${PROVIDERS[provider].keyVariable}.`);
  process.exit(1);
}

if (todo.length === 0) {
  console.log("Nothing to profile: every chosen archetype already has a profile. Use --redo to profile them again.");
  process.exit(0);
}

if (args.redo) {
  // The chosen archetypes are taken out of the file first, so each keeps exactly one profile.
  const redone = new Set(todo.map((archetype) => archetype.name));
  const kept = readJsonl<ProfiledArchetype>(profilesPath).filter((row) => !redone.has(row.archetype));
  fs.writeFileSync(profilesPath, kept.map((row) => JSON.stringify(row) + "\n").join(""));
}
fs.mkdirSync(path.dirname(profilesPath), { recursive: true });

if (provider === "deepseek" && isDeepSeekPeak(new Date())) {
  console.log("DeepSeek is in peak hours (weekdays 01:00-04:00 and 06:00-10:00 UTC), so this run costs double.");
}
console.log(`Profiling ${todo.length} archetypes with ${model}...`);
if (provider === "deepseek") {
  const client = new OpenAI({ baseURL: DEEPSEEK_BASE_URL, apiKey, maxRetries: 5 });
  await run((message) => askDeepSeek(client, message));
} else {
  const client = new Anthropic({ apiKey, maxRetries: 5 });
  await run((message) => askClaude(client, message));
}
finish();
