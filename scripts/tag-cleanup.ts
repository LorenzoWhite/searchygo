/**
 * Checks a model's tags against the card itself and corrects what can be verified mechanically.
 * Card text always puts archetypes and card names in quotes, and a card's own archetype is known
 * from the card data, so neither has to be taken on trust from the model.
 */
import { ATTRIBUTES, CARD_KINDS, MONSTER_TYPES, SUBTYPES, type Card } from "../src/lib/card.ts";
import { ROLES, type CardFilter, type CardTags, type GameEvent } from "../src/lib/tags.ts";

/**
 * Commands that move a chosen card, as card text gives them ("Add 1", "Special Summon up to 2", "Set
 * 1"), and the verbs they are tagged as. A passive "is Special Summoned by" is not a command.
 */
const COMMAND = /\b(Add|Special Summon|Send|Set|Place|Banish|Shuffle|Return) (?:up to |any number of |\d+ |a |an )/gi;
const COMMAND_VERBS: Record<string, GameEvent["verb"]> = {
  add: "add_to_hand",
  "special summon": "special_summon",
  send: "send_to_gy",
  set: "set_spell_trap",
  place: "place_on_field",
  banish: "banish",
  shuffle: "return_to_deck",
  return: "return_to_deck",
};

export function cleanTags(card: Card, tags: CardTags): CardTags {
  const text = `${card.pendulumText ?? ""}\n${card.text}`;
  const quoted = (name: string) => text.includes(`"${name}"`);

  const cleanFilter = (filter: CardFilter): CardFilter => ({
    ...filter,
    // Listing every kind means "any card", which the schema writes as an empty list.
    kinds: CARD_KINDS.every((kind) => filter.kinds.includes(kind)) ? [] : filter.kinds,
    archetypes: filter.archetypes.filter(quoted),
    names: filter.names.filter(quoted),
  });
  const cleanEvent = (event: GameEvent): GameEvent => restoreNamedTarget(restoreMention({ ...event, what: cleanFilter(event.what) }));

  // "add 1 Spell/Trap that mentions "Blue-Eyes White Dragon"": a condition the tagging sometimes drops,
  // which turns a card-locked searcher into one that seems to fetch any Spell/Trap. Each such phrase
  // belongs to the nearest command before it in the same sentence ("Special Summon 1 Level 7 or lower
  // monster that mentions…"), so it goes back on an effect with that verb, unless it already names
  // what it can take.
  const mentions = [...text.matchAll(/(?:that|which) mentions? "([^"]+)"/g)].flatMap((match) => {
    const clause = text.slice(0, match.index).split(/[.;:]/).pop()!;
    const commands = [...clause.matchAll(COMMAND)];
    const command = commands.at(-1);
    if (!command) return [];
    const noun = clause.slice(command.index! + command[0].length);
    return [{ verb: COMMAND_VERBS[command[1]!.toLowerCase()]!, kinds: CARD_KINDS.filter((kind) => new RegExp(`\\b${kind}`, "i").test(noun.split(",").pop()!)), name: match[1]! }];
  });
  // "send any number of "Volcanic Scattershot" from your hand and/or Deck": a named target the tagging
  // sometimes drops, which makes an effect that only moves copies of itself look like it moves anything.
  // A quoted name followed by "card(s)" or "monster(s)" is an archetype; on its own, a card.
  const namedTargets = [
    ...text.matchAll(/\b(Add|Special Summon|Send|Set|Place|Banish|Shuffle|Return) (?:up to \d+ |any number of |\d+ |a |an )?(?:other |copies of )?"([^"]+)"( (?:cards?|monsters?|Spells?|Traps?|Spell\/Traps?)\b)?/gi),
  ].map(([, command, name, kind]) => ({ verb: COMMAND_VERBS[command!.toLowerCase()]!, name: name!, archetype: !!kind }));
  function restoreNamedTarget(event: GameEvent): GameEvent {
    const { what } = event;
    if (what.this_card || what.names.length || what.archetypes.length || /mention/i.test(what.other)) return event;
    const target = namedTargets.find(({ verb }) => verb === event.verb);
    if (!target) return event;
    return { ...event, what: target.archetype ? { ...what, archetypes: [target.name] } : { ...what, names: [target.name] } };
  }

  function restoreMention(event: GameEvent): GameEvent {
    const { what } = event;
    if (what.this_card || what.names.length || what.archetypes.length || /mention/i.test(what.other)) return event;
    const fits = mentions.find(({ verb, kinds }) => verb === event.verb && (!kinds.length || !what.kinds.length || what.kinds.some((kind) => kinds.includes(kind))));
    if (!fits) return event;
    return { ...event, what: { ...what, other: [what.other, `mentions "${fits.name}"`].filter(Boolean).join(", ") } };
  }

  return {
    ...tags,
    effects: tags.effects.map((effect) => ({
      ...effect,
      triggers: effect.triggers.map(cleanEvent),
      costs: effect.costs.map(cleanEvent),
      actions: effect.actions.map(cleanEvent),
    })),
    materials: tags.materials.map(cleanFilter),
    supports: {
      ...tags.supports,
      // Belonging to an archetype counts as supporting it: its members are searched and reused by name.
      archetypes: [
        ...new Set([
          ...(card.archetype ? [card.archetype] : []),
          ...tags.supports.archetypes.filter((name) => quoted(name) || card.name.includes(name)),
        ]),
      ],
      // Every card quotes its own name, which says nothing about what it works with.
      names: tags.supports.names.filter((name) => quoted(name) && name !== card.name),
    },
  };
}

// --- Before validation: near misses in a model's reply ---------------------------------------

const VOCABULARY_FIELDS = ["kinds", "subtypes", "types", "attributes"] as const;
type VocabularyField = (typeof VOCABULARY_FIELDS)[number];

/** "Quick-Play", "quick play" and "Beast-Type" should all find their official spelling. */
const key = (value: string) => value.toLowerCase().replace(/[\s-]+/g, "_").replace(/_type$/, "");
const byKey = (values: readonly string[]) => new Map(values.map((value) => [key(value), value]));

const VOCABULARY: Record<VocabularyField, Map<string, string>> = {
  kinds: new Map([...byKey(CARD_KINDS), ...CARD_KINDS.map((kind) => [`${kind}s`, kind] as const)]),
  subtypes: byKey(SUBTYPES),
  types: byKey(MONSTER_TYPES),
  attributes: byKey(ATTRIBUTES),
};
/** Words a model writes to mean "no restriction", which the schema expresses as an empty list. */
const UNRESTRICTED = new Set(["card", "cards", "any", "all"]);

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Sorts the words in a filter's vocabulary lists into the lists they belong to: a "Tuner" given as
 * a Type becomes a subtype, "Quick-Play" becomes "quick_play", "card" disappears. Words that fit
 * nowhere are returned separately rather than dropped.
 */
function sortVocabulary(filter: Record<string, unknown>, fields: readonly VocabularyField[]) {
  const sorted: Record<VocabularyField, string[]> = { kinds: [], subtypes: [], types: [], attributes: [] };
  const unknown: string[] = [];
  for (const field of fields) {
    for (const word of asArray(filter[field])) {
      if (typeof word !== "string") continue;
      // A "counter" given as a kind of card is a Spell Counter or similar, not a Counter Trap.
      const elsewhere = field === "kinds" && key(word) === "counter" ? undefined : VOCABULARY_FIELDS.find((other) => VOCABULARY[other].has(key(word)));
      const home = VOCABULARY[field].has(key(word)) ? field : elsewhere;
      if (home) sorted[home].push(VOCABULARY[home].get(key(word))!);
      else if (!UNRESTRICTED.has(key(word))) unknown.push(word);
    }
  }
  const lists = Object.fromEntries(fields.map((field) => [field, [...new Set(sorted[field])]]));
  return { lists, unknown };
}

/**
 * Repairs the slips that say nothing about whether the model understood the card: an id written as
 * a string, and out-of-vocabulary words in the descriptive lists, so that one "kinds": ["card"]
 * does not cost a whole card its tags. Verbs, zones and timing are left alone: a wrong value there
 * means the model misread the card, and the entry should fail and be retried.
 * Expects an entry that has been through `fillDefaults`.
 */
export function repairEntry(entry: unknown): unknown {
  const filter = (value: unknown) => {
    const given = asObject(value);
    const { lists, unknown } = sortVocabulary(given, VOCABULARY_FIELDS);
    const other = [given.other, ...unknown].filter((part) => typeof part === "string" && part).join(", ");
    return { ...given, ...lists, other };
  };
  const event = (value: unknown) => ({ ...asObject(value), what: filter(asObject(value).what) });
  const effect = (value: unknown) => {
    const given = asObject(value);
    return {
      ...given,
      triggers: asArray(given.triggers).map(event),
      costs: asArray(given.costs).map(event),
      actions: asArray(given.actions).map(event),
    };
  };

  const given = asObject(entry);
  const supports = asObject(given.supports);
  return {
    ...given,
    id: typeof given.id === "string" && /^\d+$/.test(given.id) ? Number(given.id) : given.id,
    roles: [...new Set(asArray(given.roles).map((role) => (typeof role === "string" ? key(role) : role)))].filter(
      (role) => typeof role === "string" && role in ROLES,
    ),
    effects: asArray(given.effects).map(effect),
    materials: asArray(given.materials).map(filter),
    supports: { ...supports, ...sortVocabulary(supports, ["subtypes", "types", "attributes"]).lists },
  };
}
