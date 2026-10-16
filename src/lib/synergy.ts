/**
 * Synergy: which cards from outside an archetype work well with it.
 *
 * A model reads an archetype's cards once (`scripts/profile-archetypes.ts`) and writes an
 * `ArchetypeProfile`: a few hooks, each describing one kind of outside card that helps the deck, in
 * the vocabulary the card tags already use. Finding those cards is then ordinary tag matching, done
 * here, so a synergy search costs nothing to answer.
 */
import * as z from "zod";
import { ATTRIBUTES, CARD_KINDS, MONSTER_TYPES, SUBTYPES, type Card } from "./card.ts";
import { matchCard } from "./effect-match.ts";
import type { EffectQuery, EventQuery, ObjectQuery } from "./query.ts";
import type { CardTags } from "./tags.ts";
import { VERBS, ZONES } from "./vocabulary.ts";

const keys = <T extends Record<string, string>>(record: T) => Object.keys(record) as [keyof T & string, ...(keyof T & string)[]];

/** Which cards something is about. Empty lists and 0 mean "any". */
const Things = z.object({
  kinds: z.array(z.enum(CARD_KINDS)),
  subtypes: z.array(z.enum(SUBTYPES)),
  types: z.array(z.enum(MONSTER_TYPES)),
  attributes: z.array(z.enum(ATTRIBUTES)),
  level_min: z.int(),
  level_max: z.int(),
});
type Things = z.infer<typeof Things>;

const Happening = z.object({
  verbs: z.array(z.enum(keys(VERBS))).describe("Any one of these counts"),
  from: z.array(z.enum(keys(ZONES))).describe("Where the affected cards come from. Empty when it does not matter"),
  player: z.enum(["you", "opponent", "any"]).describe("Whose cards are affected, from the side of the player using the outside card"),
  self: z.boolean().describe("True when the event is about the outside card itself"),
  what: Things,
});
type Happening = z.infer<typeof Happening>;

/** One kind of outside card that helps the deck, and how to recognise it from a card on its own. */
export const Hook = z.object({
  label: z.string().describe("Two to five words naming the kind of card, as a player would say it"),
  why: z.string().describe("One sentence on what in this archetype makes that kind of card good with it"),
  does: Happening.nullable().describe("Something the outside card causes, as an effect or as a cost"),
  reacts_to: Happening.nullable().describe("Something the outside card responds to"),
  card: Things.nullable().describe("What the outside card itself must be"),
  supports: z
    .object({ types: z.array(z.enum(MONSTER_TYPES)), attributes: z.array(z.enum(ATTRIBUTES)) })
    .nullable()
    .describe("Set when the outside card must be support for a monster Type or Attribute"),
  phrases: z.array(z.string()).describe("Game terms that must all appear in the outside card's printed text"),
});
export type Hook = z.infer<typeof Hook>;

export const ArchetypeProfile = z.object({
  plan: z.string().describe("One sentence on what the deck does"),
  hooks: z.array(Hook),
});
export type ArchetypeProfile = z.infer<typeof ArchetypeProfile>;

/** A line of data/synergy/profiles.jsonl. */
export interface ProfiledArchetype {
  archetype: string;
  /** How many cards the archetype had when it was profiled. */
  cards: number;
  model: string;
  effort?: string;
  profile: ArchetypeProfile;
}

export const MAX_HOOKS = 6;
const MIN_PHRASE_LENGTH = 3;

// --- Reading a model's reply -------------------------------------------------------------------

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const whole = (value: unknown) => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : 0);

/**
 * Matches what a model wrote against a vocabulary, forgiving case and spacing ("wyrm", "Quick-Play").
 * Returns null when any entry is not in the vocabulary: dropping it would quietly widen the hook.
 */
function within<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  const canonical = new Map(allowed.map((term) => [term.toLowerCase().replace(/[-_ ]/g, ""), term]));
  const found: T[] = [];
  for (const item of asList(value)) {
    const term = typeof item === "string" ? canonical.get(item.toLowerCase().replace(/[-_ ]/g, "")) : undefined;
    if (!term) return null;
    found.push(term);
  }
  return found;
}

const NO_THINGS: Things = { kinds: [], subtypes: [], types: [], attributes: [], level_min: 0, level_max: 0 };
const isAnything = (things: Things) =>
  !things.kinds.length && !things.subtypes.length && !things.types.length && !things.attributes.length && !things.level_min && !things.level_max;

function readThings(value: unknown): Things | null {
  const given = asObject(value) ?? {};
  const kinds = within(given.kinds, CARD_KINDS);
  const subtypes = within(given.subtypes, SUBTYPES);
  const types = within(given.types, MONSTER_TYPES);
  const attributes = within(given.attributes, ATTRIBUTES);
  if (!kinds || !subtypes || !types || !attributes) return null;
  return { kinds, subtypes, types, attributes, level_min: whole(given.level_min), level_max: whole(given.level_max) };
}

function readHappening(value: unknown): Happening | null | "invalid" {
  const given = asObject(value);
  if (!given) return null;
  const verbs = within(given.verbs ?? given.verb, keys(VERBS));
  const from = within(given.from, keys(ZONES));
  const what = readThings(given.what);
  if (!verbs?.length || !from || !what) return "invalid";
  const player = given.player === "you" || given.player === "opponent" ? given.player : "any";
  return { verbs, from, player, self: given.self === true, what };
}

/**
 * Reads one hook as a model wrote it. Returns the reason instead when it cannot be used.
 * `checkedElsewhere` is for callers that check something more about the card (a counter's roles),
 * so a hook made of that alone is not refused for saying nothing.
 */
export function readHook(value: unknown, archetype: string, checkedElsewhere = false): Hook | string {
  const given = asObject(value);
  const label = text(given?.label);
  if (!given || !label) return "a hook with no label";

  const does = readHappening(given.does);
  const reactsTo = readHappening(given.reacts_to);
  const card = given.card == null ? null : readThings(given.card);
  const supported = asObject(given.supports);
  const types = within(supported?.types, MONSTER_TYPES);
  const attributes = within(supported?.attributes, ATTRIBUTES);
  if (does === "invalid" || reactsTo === "invalid" || (given.card != null && !card) || !types || !attributes) {
    return `"${label}" uses a term outside the vocabulary`;
  }

  const phrases = asList(given.phrases).map(text).filter(Boolean);
  if (phrases.some((phrase) => phrase.length < MIN_PHRASE_LENGTH)) return `"${label}" has a phrase too short to mean anything`;
  // A hook that names the archetype would only find the archetype's own support, which is not the point.
  if (phrases.some((phrase) => phrase.toLowerCase().includes(archetype.toLowerCase()))) return `"${label}" looks for the archetype's own name`;

  const supports = types.length || attributes.length ? { types, attributes } : null;
  const described = card && !isAnything(card) ? card : null;
  // A hook may be nothing but a kind of card ("Level 4 DARK Winged Beast", "Wyrm Synchro monsters"),
  // which is how a deck's materials are described. Only "any monster" or "any Spell" says too little.
  const particular = described && (described.subtypes.length || described.types.length || described.attributes.length || described.level_min || described.level_max);
  if (!does && !reactsTo && !supports && !phrases.length && !particular && !checkedElsewhere) return `"${label}" says nothing a card can be checked against`;
  return { label, why: text(given.why), does, reacts_to: reactsTo, card: described, supports, phrases };
}

/**
 * Reads a profile from a model's reply, keeping the hooks that can be used and reporting the rest.
 * Returns null when there is no plan or no usable hook.
 */
export function readProfile(reply: unknown, archetype: string): { profile: ArchetypeProfile; dropped: string[] } | null {
  const given = asObject(reply);
  const plan = text(given?.plan);
  if (!given || !plan) return null;

  const hooks: Hook[] = [];
  const dropped: string[] = [];
  for (const raw of asList(given.hooks)) {
    const hook = readHook(raw, archetype);
    if (typeof hook === "string") dropped.push(hook);
    else if (hooks.length < MAX_HOOKS) hooks.push(hook);
  }
  return hooks.length ? { profile: { plan, hooks }, dropped } : null;
}

// --- Finding the cards a profile describes -----------------------------------------------------

const toObject = (things: Things | null): ObjectQuery => {
  const { kinds, subtypes, types, attributes, level_min, level_max } = things ?? NO_THINGS;
  return { kinds, subtypes, types, attributes, archetypes: [], levelMin: level_min || undefined, levelMax: level_max || undefined };
};

/**
 * An event done to the deck's cards has to be able to reach them. Asking for the archetype by name
 * rules out an outside card whose effect only works on some other archetype's cards ("send 1
 * 'Shaddoll' card from your Deck to the GY"), while leaving every effect that names nobody.
 */
const toEvent = (happening: Happening | null, archetype: string): EventQuery | undefined =>
  happening
    ? {
        verbs: happening.verbs,
        from: happening.from,
        player: happening.player === "any" ? undefined : happening.player,
        self: happening.self,
        object: { ...toObject(happening.what), archetypes: happening.self ? [] : [archetype] },
      }
    : undefined;

/** The hook as the effect query the tag matcher answers. Its phrases are checked separately. */
export const hookQuery = (hook: Hook, archetype: string): EffectQuery => ({
  card: toObject(hook.card),
  roles: [],
  does: toEvent(hook.does, archetype),
  reactsTo: toEvent(hook.reacts_to, archetype),
  supports: hook.supports ? { ...toObject(null), ...hook.supports } : undefined,
  quick: false,
  text: "",
});

export interface Candidate {
  card: Card;
  tags?: CardTags;
}

/** A hook that fits more than this share of all cards describes nothing in particular, and is not used. */
const TOO_COMMON_SHARE = 0.05;

export interface HookResult {
  hook: Hook;
  /** How many outside cards fit it. */
  matches: number;
  /** Fits so many cards that it says nothing about any of them; it is left out of the search. */
  ignored: boolean;
}

export interface Partner {
  /** Position of the card in the list that was searched. */
  index: number;
  /** Positions in `hooks` of the hooks this card fits, in the profile's order. */
  fits: number[];
}

export const belongsTo = (card: Card, archetype: string) =>
  card.archetype?.toLowerCase() === archetype.toLowerCase() || card.name.toLowerCase().includes(archetype.toLowerCase());

/**
 * Finds the cards outside an archetype that its profile describes.
 *
 * Cards that fit several hooks come first. After them the hooks take turns, each giving its next
 * best card, so the first page shows something for every reason a card might fit instead of a
 * hundred cards for the commonest reason. Within a hook the cards that name the same thing the hook
 * does come before the ones that merely allow it, and the well-known before the obscure.
 */
export function findPartners(profile: ArchetypeProfile, archetype: string, candidates: readonly Candidate[]): { hooks: HookResult[]; partners: Partner[] } {
  const printed = candidates.map(({ card }) => `${card.pendulumText ?? ""}\n${card.text}`.toLowerCase());
  const outside = candidates.map(({ card }) => !belongsTo(card, archetype));
  const views = (index: number) => candidates[index]!.card.views;

  const fitting = profile.hooks.map((hook) => {
    const query = hookQuery(hook, archetype);
    const phrases = hook.phrases.map((phrase) => phrase.toLowerCase());
    const found: { index: number; specificity: number }[] = [];
    candidates.forEach(({ card, tags }, index) => {
      if (!outside[index] || !phrases.every((phrase) => printed[index]!.includes(phrase))) return;
      const specificity = matchCard(card, tags, query);
      if (specificity !== null) found.push({ index, specificity });
    });
    return found.sort((a, b) => b.specificity - a.specificity || views(b.index) - views(a.index));
  });

  const hooks: HookResult[] = profile.hooks.map((hook, at) => ({
    hook,
    matches: fitting[at]!.length,
    ignored: fitting[at]!.length > candidates.length * TOO_COMMON_SHARE,
  }));
  // When every hook is that common, the narrowest one is still better than no answer.
  if (hooks.every(({ ignored, matches }) => ignored || !matches)) {
    const narrowest = hooks.filter(({ matches }) => matches).sort((a, b) => a.matches - b.matches)[0];
    if (narrowest) narrowest.ignored = false;
  }

  const fitsOf = new Map<number, number[]>();
  hooks.forEach(({ ignored }, at) => {
    if (ignored) return;
    for (const { index } of fitting[at]!) fitsOf.set(index, [...(fitsOf.get(index) ?? []), at]);
  });

  const partners: Partner[] = [...fitsOf]
    .filter(([, fits]) => fits.length > 1)
    .sort(([a, fitsA], [b, fitsB]) => fitsB.length - fitsA.length || views(b) - views(a))
    .map(([index, fits]) => ({ index, fits }));

  const queues = hooks.map(({ ignored }, at) => (ignored ? [] : fitting[at]!.filter(({ index }) => fitsOf.get(index)!.length === 1)));
  for (let turn = 0; queues.some((queue) => turn < queue.length); turn++) {
    queues.forEach((queue, at) => {
      if (queue[turn]) partners.push({ index: queue[turn]!.index, fits: [at] });
    });
  }
  return { hooks, partners };
}
