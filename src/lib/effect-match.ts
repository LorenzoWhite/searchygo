/**
 * Decides whether a tagged card satisfies an effect query, and how specifically.
 *
 * A card's filter on an event is a restriction ("1 WATER monster", "1 monster", "1 'HERO' card").
 * A query asks for something concrete ("a WATER monster"). The card matches when its restriction
 * allows what was asked for, and it matches more specifically when it names the same thing than
 * when it merely does not rule it out: a card that revives WATER monsters ranks above Monster Reborn.
 */
import { isExtraDeckCard, type Card } from "./card.ts";

const EXTRA_SUBTYPES = new Set(["fusion", "synchro", "xyz", "link"]);
import { fitsCardStats, fitsStatedStats, isEmptyStats, statsInText } from "./stats.ts";
import { isEmptyObject, type EffectQuery, type EventQuery, type ObjectQuery } from "./query.ts";
import type { CardFilter, CardTags, Effect, GameEvent } from "./tags.ts";

/** Events whose tags carry no zone, so a zone in the query cannot be checked against them. */
const ZONELESS = new Set<GameEvent["verb"]>(["draw", "negate_activation", "negate_effect", "negate_summon", "negate_attack", "inflict_damage", "gain_lp"]);
/** How much less a restriction the query never asked about is worth than an unrestricted effect. */
const NARROWER_PENALTY = 0.5;
const SAME_EFFECT_BONUS = 1;

const sameArchetype = (a: string, b: string) => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  // "HERO" support covers "Elemental HERO" cards and the reverse is at least partly true.
  return x === y || x.includes(y) || y.includes(x);
};

/** Null when the filter rules out what was asked for; otherwise how many things it names outright. */
function matchObject(what: CardFilter, wanted: ObjectQuery): number | null {
  let specific = 0;
  let narrower = false;

  // "Extra Deck monsters": an effect naming only Main Deck kinds of monster cannot reach them, and the reverse.
  if (wanted.deck && what.subtypes.length) {
    const extra = what.subtypes.some((subtype) => EXTRA_SUBTYPES.has(subtype));
    if (extra !== (wanted.deck === "extra")) return null;
    specific++;
  }

  // Stats live in the tags as words ("1500 or less ATK"); asking for them means the effect must state them.
  if (!isEmptyStats(wanted.stats)) {
    if (!fitsStatedStats(statsInText(what.other), wanted.stats!)) return null;
    specific++;
  }

  if (wanted.kinds.length && what.kinds.length && !wanted.kinds.some((kind) => what.kinds.includes(kind))) return null;

  const lists = [
    [wanted.subtypes, what.subtypes],
    [wanted.types, what.types],
    [wanted.attributes, what.attributes],
  ] as const;
  for (const [asked, allowed] of lists) {
    if (!allowed.length) continue;
    if (!asked.length) narrower = true;
    else if (asked.some((value) => (allowed as readonly string[]).includes(value))) specific++;
    else return null;
  }

  // "a Spell/Trap that mentions "Crimson Dragon"" is kept in the tags' words; it names a card all the same.
  const names = [...what.names, ...[...what.other.matchAll(/mentions? "([^"]+)"/g)].map(([, name]) => name!)];
  const named = what.archetypes.length > 0 || names.length > 0;
  if (wanted.archetypes.length) {
    if (named) {
      const fits = wanted.archetypes.some(
        (name) => what.archetypes.some((archetype) => sameArchetype(archetype, name)) || names.some((card) => card.toLowerCase().includes(name.toLowerCase())),
      );
      if (!fits) return null;
      specific += 2;
    }
  } else if (named) narrower = true;

  const bounded = what.level_min > 0 || what.level_max > 0;
  if (wanted.levelMin !== undefined || wanted.levelMax !== undefined) {
    if (bounded) {
      const overlaps = (wanted.levelMin ?? 0) <= (what.level_max || Infinity) && (wanted.levelMax ?? Infinity) >= what.level_min;
      if (!overlaps) return null;
      specific++;
    }
  } else if (bounded) narrower = true;

  return specific - (narrower && !isEmptyObject(wanted) ? NARROWER_PENALTY : 0);
}

function matchEvent(event: GameEvent, wanted: EventQuery): number | null {
  if (!wanted.verbs.includes(event.verb)) return null;
  if (wanted.generic && (event.what.archetypes.length || event.what.names.length || /mentions? "/.test(event.what.other))) return null;
  // No zone given means none was stated: a zoneless verb, or the card's own event ("If this card is
  // Tributed"), which happens wherever the card is.
  const anywhere = !event.from.length && (ZONELESS.has(event.verb) || (wanted.self && event.what.this_card));
  if (wanted.from.length && !anywhere && !wanted.from.some((zone) => event.from.includes(zone))) return null;
  if (wanted.player && event.player !== wanted.player && event.player !== "either") return null;

  if (wanted.self) return event.what.this_card ? 1 : null;
  // An effect about the card itself says nothing about "a WATER monster".
  if (event.what.this_card && !isEmptyObject(wanted.object)) return null;
  return matchObject(event.what, wanted.object);
}

const best = (events: GameEvent[], wanted: EventQuery) =>
  events.reduce<number | null>((top, event) => {
    const score = matchEvent(event, wanted);
    return score !== null && (top === null || score > top) ? score : top;
  }, null);

function matchEffects(effects: Effect[], query: EffectQuery): number | null {
  let top: number | null = null;
  let topDoes: number | null = null;
  let topReacts: number | null = null;
  const consider = (score: number) => {
    if (top === null || score > top) top = score;
  };

  for (const effect of effects) {
    if (query.quick && effect.timing !== "quick") continue;
    if (query.worksFrom && !effect.location.includes(query.worksFrom)) continue;
    // Paying a cost also makes the thing happen, so "send from Deck to GY" includes cards that do it as a cost.
    const does = query.does ? best([...effect.actions, ...effect.costs], query.does) : 0;
    const reacts = query.reactsTo ? best(effect.triggers, query.reactsTo) : 0;
    if (does !== null && (topDoes === null || does > topDoes)) topDoes = does;
    if (reacts !== null && (topReacts === null || reacts > topReacts)) topReacts = reacts;
    if (does !== null && reacts !== null) consider(does + reacts + (query.does && query.reactsTo ? SAME_EFFECT_BONUS : 0));
  }
  // "When X, do Y" usually means one effect, but a card with both on separate effects still fits.
  if (top === null && topDoes !== null && topReacts !== null) return topDoes + topReacts;
  return top;
}

function matchCardItself(card: Card, wanted: ObjectQuery): boolean {
  if (wanted.kinds.length && !wanted.kinds.includes(card.kind)) return false;
  if (!isEmptyStats(wanted.stats) && !fitsCardStats(card, wanted.stats!)) return false;
  if (wanted.deck && isExtraDeckCard(card) !== (wanted.deck === "extra")) return false;
  if (!wanted.subtypes.every((subtype) => card.subtypes.includes(subtype))) return false;
  if (wanted.types.length && !(card.monsterType && wanted.types.includes(card.monsterType))) return false;
  if (wanted.attributes.length && !(card.attribute && wanted.attributes.includes(card.attribute))) return false;
  if (wanted.levelMin !== undefined || wanted.levelMax !== undefined) {
    const level = card.level ?? card.rank ?? card.linkRating;
    if (level == null || level < (wanted.levelMin ?? 0) || level > (wanted.levelMax ?? Infinity)) return false;
  }
  return true;
}

function matchSupports(card: Card, tags: CardTags, wanted: ObjectQuery): boolean {
  const { archetypes, types, attributes } = tags.supports;
  const name = card.name.toLowerCase();
  return (
    wanted.archetypes.every((asked) => name.includes(asked.toLowerCase()) || archetypes.some((archetype) => archetype.toLowerCase() === asked.toLowerCase())) &&
    wanted.types.every((type) => (types as string[]).includes(type)) &&
    wanted.attributes.every((attribute) => attributes.includes(attribute))
  );
}

/**
 * The card's own words, for checking what it names: an Extra Deck monster's first line lists its
 * materials ("1 Tuner + 1+ non-Tuner monsters"), which is not the card supporting anything.
 */
function ownWords(card: Card): string {
  const materials = card.subtypes.some((subtype) => subtype === "fusion" || subtype === "synchro" || subtype === "xyz" || subtype === "link");
  const text = materials ? card.text.split("\n").slice(1).join("\n") : card.text;
  return `${card.pendulumText ?? ""}\n${text}`;
}

/** Null when the card does not satisfy the query. Otherwise its specificity: higher fits more exactly. */
export function matchCard(card: Card, tags: CardTags | undefined, query: EffectQuery): number | null {
  if (!matchCardItself(card, query.card)) return null;
  if (query.mentions?.length) {
    const words = ownWords(card);
    if (!query.mentions.every((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(words))) return null;
  }
  // "Generic" with nothing to do: a card that belongs to no archetype and supports none.
  if (query.generic && !query.does && !query.reactsTo && (card.archetype || tags?.supports.archetypes.length)) return null;

  const needsTags = query.does || query.reactsTo || query.supports || query.roles.length > 0 || query.quick || query.worksFrom;
  if (!needsTags) return 0;
  if (!tags) return null;

  if (!query.roles.every((role) => tags.roles.includes(role))) return null;
  if (query.supports && !matchSupports(card, tags, query.supports)) return null;
  if (!query.does && !query.reactsTo && !query.quick && !query.worksFrom) return 0;
  return matchEffects(tags.effects, query);
}
