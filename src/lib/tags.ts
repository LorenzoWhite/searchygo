/**
 * The structured description of what a card does. One `CardTags` record is produced per card by the
 * tagging job (`scripts/tag-cards.ts`) and consumed by the search engine.
 *
 * The core idea: everything a card does, costs, or reacts to is a `GameEvent` built from the same
 * vocabulary. That makes "cards that do X" a filter on `actions`, and "cards that work with X" a
 * match between one card's `actions`/`costs` and another card's `triggers`.
 *
 * Every field is always present in stored tags (empty array / "" / 0 when not applicable). A model
 * that is not held to the schema by its API may leave empty fields out to save output; see
 * `fillDefaults`.
 */
import * as z from "zod";
import { ATTRIBUTES, CARD_KINDS, MONSTER_TYPES, SUBTYPES } from "./card.ts";
import { LIMITS, ROLES, TIMINGS, VERBS, ZONES } from "./vocabulary.ts";

export { LIMITS, ROLES, TIMINGS, VERBS, ZONES };

const keys = <T extends Record<string, string>>(record: T) =>
  Object.keys(record) as [keyof T & string, ...(keyof T & string)[]];

const Zone = z.enum(keys(ZONES));
const Verb = z.enum(keys(VERBS));

/** Which cards an event applies to. Empty lists mean "no restriction of that kind". */
export const CardFilter = z.object({
  this_card: z.boolean().describe("True when the event happens to this card itself"),
  kinds: z.array(z.enum(CARD_KINDS)).describe("Empty = any card"),
  subtypes: z.array(z.enum(SUBTYPES)).describe('e.g. ["link"], ["tuner"], ["field"]'),
  types: z.array(z.enum(MONSTER_TYPES)).describe("Monster Types named, e.g. Dragon"),
  attributes: z.array(z.enum(ATTRIBUTES)),
  archetypes: z.array(z.string()).describe('Archetype names exactly as quoted on the card, e.g. "HERO"'),
  names: z.array(z.string()).describe("Specific card names referenced"),
  level_min: z.int().describe("Lowest Level allowed, 0 = no lower bound"),
  level_max: z.int().describe("Highest Level allowed, 0 = no upper bound"),
  other: z
    .string()
    .describe('Any remaining restriction in a few words, e.g. "1500 or less ATK", "Rank 4", "face-up", "non-Tuner". "" if none'),
});
export type CardFilter = z.infer<typeof CardFilter>;

export const GameEvent = z.object({
  verb: Verb,
  player: z
    .enum(["you", "opponent", "either"])
    .describe("Whose cards (or Life Points, or actions) the event involves, relative to this card's controller"),
  from: z.array(Zone).describe("Where the affected cards are before the event. Empty if unspecified or not applicable"),
  what: CardFilter,
  note: z.string().describe('Short clarification the fields above cannot express. "" if none'),
});
export type GameEvent = z.infer<typeof GameEvent>;

export const Effect = z.object({
  timing: z.enum(keys(TIMINGS)),
  location: z.array(Zone).describe("Where this card is when the effect is used or applies"),
  limit: z.enum(keys(LIMITS)),
  targets: z.boolean().describe("True if the effect targets"),
  conditions: z
    .array(z.string())
    .describe('Requirements that are states, not events, e.g. "you control no monsters", "you control a Spellcaster monster"'),
  triggers: z.array(GameEvent).describe("Events this effect responds to"),
  costs: z.array(GameEvent).describe("What must be paid or done to activate it (the part before the semicolon)"),
  actions: z.array(GameEvent).describe("What the effect does when it resolves or while it applies"),
});
export type Effect = z.infer<typeof Effect>;

export const CardTags = z.object({
  summary: z
    .string()
    .describe("One or two plain-English sentences on what the card does and why a player would run it"),
  roles: z.array(z.enum(keys(ROLES))),
  keywords: z
    .array(z.string())
    .describe("Up to 6 short terms players would type to find this effect that are not already in the summary (slang, nicknames, comparable famous cards)"),
  effects: z.array(Effect).describe("One entry per distinct effect or Summoning procedure, in card-text order"),
  materials: z
    .array(CardFilter)
    .describe("Extra Deck monsters only: one entry per material requirement. Empty for every other card"),
  supports: z
    .object({
      archetypes: z.array(z.string()),
      names: z.array(z.string()),
      types: z.array(z.enum(MONSTER_TYPES)),
      attributes: z.array(z.enum(ATTRIBUTES)),
      subtypes: z.array(z.enum(SUBTYPES)),
    })
    .describe("Everything this card works with: its own archetype, plus whatever its text names as something it needs or benefits"),
});
export type CardTags = z.infer<typeof CardTags>;

/** A line of data/tags/tags.jsonl. */
export interface TaggedCard {
  id: number;
  name: string;
  model: string;
  /** Reasoning effort the model ran at, so cards tagged on the cheap can be found and redone later. */
  effort?: string;
  tags: CardTags;
}

export const NO_FILTER: CardFilter = {
  this_card: false,
  kinds: [],
  subtypes: [],
  types: [],
  attributes: [],
  archetypes: [],
  names: [],
  level_min: 0,
  level_max: 0,
  other: "",
};

export const THIS_CARD: CardFilter = { ...NO_FILTER, this_card: true };

/** The fields a tag entry must always spell out. Every other field has an empty value it can default to. */
export const ALWAYS_PRESENT = ["id", "summary", "timing", "verb", "player"] as const;

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Fills in the fields a model left out with their empty values, so a sparse reply can be validated
 * against the full schema. It only adds what is missing; anything wrong is left for validation to catch.
 */
export function fillDefaults(entry: unknown): unknown {
  const filter = (value: unknown) => ({ ...NO_FILTER, ...asObject(value) });
  const event = (value: unknown) => {
    const given = asObject(value);
    return { from: [], note: "", ...given, what: filter(given.what) };
  };
  const effect = (value: unknown) => {
    const given = asObject(value);
    return {
      location: [],
      limit: "none",
      targets: false,
      conditions: [],
      ...given,
      triggers: asArray(given.triggers).map(event),
      costs: asArray(given.costs).map(event),
      actions: asArray(given.actions).map(event),
    };
  };

  const given = asObject(entry);
  return {
    roles: [],
    keywords: [],
    ...given,
    effects: asArray(given.effects).map(effect),
    materials: asArray(given.materials).map(filter),
    supports: { archetypes: [], names: [], types: [], attributes: [], subtypes: [], ...asObject(given.supports) },
  };
}

/** The reverse of `fillDefaults`: drops every field that holds its empty value. */
export function dropDefaults(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropDefaults);
  if (!value || typeof value !== "object") return value;
  const kept: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    const item = dropDefaults(raw);
    const empty =
      item === false ||
      item === 0 ||
      item === "" ||
      (key === "limit" && item === "none") ||
      (Array.isArray(item) && item.length === 0) ||
      (!!item && typeof item === "object" && !Array.isArray(item) && Object.keys(item).length === 0);
    if (!empty) kept[key] = item;
  }
  return kept;
}
