/**
 * ATK and DEF: how a search asks for them ("2400 ATK 1000 DEF", "ATK 2000 or more", "0 DEF"), how an
 * effect's tags state them ("1500 or less ATK", "300 ATK/200 DEF", "ATK equals its own DEF"), and
 * whether a card or an effect fits.
 */
import type { Card } from "./card.ts";

export interface StatRange {
  min?: number;
  max?: number;
}

export interface StatQuery {
  atk?: StatRange;
  def?: StatRange;
  /** ATK equal to DEF, as the Gizmek cards ask for. */
  equal?: boolean;
}

type Stat = "atk" | "def";
const STATS: Stat[] = ["atk", "def"];

export const isEmptyStats = (stats: StatQuery | undefined) => !stats || (!stats.atk && !stats.def && !stats.equal);

/** Adds one condition to another, as a search names them one at a time ("2400 ATK" … "1000 DEF"). */
export function mergeStats(into: StatQuery, more: StatQuery): StatQuery {
  return {
    ...(into.atk || more.atk ? { atk: { ...into.atk, ...more.atk } } : {}),
    ...(into.def || more.def ? { def: { ...into.def, ...more.def } } : {}),
    ...(into.equal || more.equal ? { equal: true } : {}),
  };
}

const inRange = (value: number, range: StatRange) => value >= (range.min ?? -Infinity) && value <= (range.max ?? Infinity);
const overlap = (a: StatRange, b: StatRange) => (a.min ?? -Infinity) <= (b.max ?? Infinity) && (b.min ?? -Infinity) <= (a.max ?? Infinity);

/** Whether a card's printed stats fit. A "?" stat, or none (a Spell), fits nothing. */
export function fitsCardStats(card: Pick<Card, "atk" | "def">, wanted: StatQuery): boolean {
  for (const stat of STATS) {
    const range = wanted[stat];
    if (!range) continue;
    const value = card[stat];
    if (value == null || !inRange(value, range)) return false;
  }
  if (wanted.equal && (card.atk == null || card.def == null || card.atk !== card.def)) return false;
  return true;
}

/** The stat conditions an effect's tags state in plain words, as the tagging wrote them. */
export function statsInText(text: string): StatQuery {
  let found: StatQuery = {};
  if (/\bATK (?:equals|equal to|is equal to) (?:its own |their own |its )?DEF\b/.test(text)) found.equal = true;
  const stat = (word: string): Stat => (word.toUpperCase() === "ATK" ? "atk" : "def");
  for (const [, n, bound, word, alsoWord] of text.matchAll(/\b(\d{1,5}) (?:or (less|lower|more|higher) )?(?:original )?(ATK|DEF)(?: or (ATK|DEF))?\b/g)) {
    const value = Number(n);
    const range: StatRange = bound === "less" || bound === "lower" ? { max: value } : bound ? { min: value } : { min: value, max: value };
    for (const w of [word!, ...(alsoWord ? [alsoWord] : [])]) found = mergeStats(found, { [stat(w)]: range });
  }
  for (const [, word, n] of text.matchAll(/\b(ATK|DEF) (\d{1,5})\b/g)) found = mergeStats(found, { [stat(word!)]: { min: Number(n), max: Number(n) } });
  return found;
}

/** Whether an effect's stated conditions can be met by what is asked for. An effect that states none does not fit. */
export function fitsStatedStats(stated: StatQuery, wanted: StatQuery): boolean {
  for (const stat of STATS) {
    const range = wanted[stat];
    if (range && !(stated[stat] && overlap(stated[stat]!, range))) return false;
  }
  return !wanted.equal || !!stated.equal;
}

const describeRange = (label: string, range: StatRange) =>
  range.min !== undefined && range.min === range.max
    ? `${range.min} ${label}`
    : range.min !== undefined && range.max !== undefined
      ? `${label} ${range.min}–${range.max}`
      : range.min !== undefined
        ? `${label} ${range.min}+`
        : `${label} ${range.max} or less`;

export function describeStats(stats: StatQuery): string {
  return [stats.atk && describeRange("ATK", stats.atk), stats.def && describeRange("DEF", stats.def), stats.equal && "ATK = DEF"].filter(Boolean).join(" ");
}

// --- Reading a search ---------------------------------------------------------------------------

const WORD = "(atk|attack|def|defen[cs]e)";
const MORE = "more|higher|above|greater|over";
const LESS = "less|lower|below|under|fewer";
const statOf = (word: string): Stat => (word.startsWith("a") ? "atk" : "def");

/** One stat condition found in a search, with where it was found. */
export interface StatMention {
  start: number;
  end: number;
  stats: StatQuery;
}

const rule = (pattern: string, make: (match: RegExpMatchArray) => StatQuery) => ({ pattern: new RegExp(pattern, "g"), make });

const bounded = (word: string, n: string, bound: string | undefined, strict = false): StatQuery => {
  const value = Number(n);
  const above = bound !== undefined && new RegExp(`^(?:${MORE})$`).test(bound);
  const below = bound !== undefined && new RegExp(`^(?:${LESS})$`).test(bound);
  const range: StatRange = above ? { min: strict ? value + 1 : value } : below ? { max: strict ? value - 1 : value } : { min: value, max: value };
  return { [statOf(word)]: range };
};

const COMPARATIVES: Record<string, { bound: string; strict: boolean }> = {
  "at least": { bound: "more", strict: false },
  "more than": { bound: "more", strict: true },
  "greater than": { bound: "more", strict: true },
  over: { bound: "more", strict: true },
  above: { bound: "more", strict: true },
  "at most": { bound: "less", strict: false },
  "up to": { bound: "less", strict: false },
  "less than": { bound: "less", strict: true },
  under: { bound: "less", strict: true },
  below: { bound: "less", strict: true },
};
const COMPARATIVE = Object.keys(COMPARATIVES).join("|");

const EQUAL_RULE = rule(
  String.raw`\b(?:(?:atk|attack) (?:equals?|equal to|is equal to|same as|=) (?:its (?:own )?)?(?:def|defen[cs]e)|(?:same|equal|matching) (?:atk|attack) (?:and|&) (?:def|defen[cs]e))\b`,
  () => ({ equal: true }),
);
const RANGE_RULE = rule(String.raw`\b${WORD} ?(?:of |[:/=] ?)?(\d{1,5}) ?(?:-|–|to) ?(\d{1,5})\b`, ([, word, a, b]) => ({ [statOf(word!)]: { min: Number(a), max: Number(b) } }));
/** "2400 atk", "2000 or more atk", "2000+ atk", "over 2000 atk". */
const NUMBER_FIRST = [
  rule(String.raw`\b(\d{1,5}) ?(?:or (${MORE}|${LESS})|(\+)) ?(?:original )?${WORD}\b`, ([, n, bound, plus, word]) => bounded(word!, n!, plus ? "more" : bound)),
  rule(String.raw`\b(${COMPARATIVE}) (\d{1,5}) ?(?:original )?${WORD}\b`, ([, c, n, word]) => bounded(word!, n!, COMPARATIVES[c!]!.bound, COMPARATIVES[c!]!.strict)),
  rule(String.raw`\b(\d{1,5}) ?(?:original )?${WORD}\b`, ([, n, word]) => bounded(word!, n!, undefined)),
];
/** "atk 2400", "atk 2000 or more", "atk over 2000". */
const WORD_FIRST = [
  rule(String.raw`\b${WORD} ?(?:of |[:/=] ?)?(\d{1,5}) ?(?:or (${MORE}|${LESS})|(\+))`, ([, word, n, bound, plus]) => bounded(word!, n!, plus ? "more" : bound)),
  rule(String.raw`\b${WORD} (?:of )?(${COMPARATIVE}) (\d{1,5})\b`, ([, word, c, n]) => bounded(word!, n!, COMPARATIVES[c!]!.bound, COMPARATIVES[c!]!.strict)),
  rule(String.raw`\b${WORD} ?(?:of |[:/=] ?)?(\d{1,5})\b`, ([, word, n]) => bounded(word!, n!, undefined)),
];

/**
 * The stat conditions a search names, in the order of the rules that found them. Whether a number
 * comes before or after its stat is decided once for the whole search, as people write it one way
 * throughout: "2400 ATK 1000 DEF" or "ATK 2400 DEF 1000".
 */
export function statsInSearch(text: string): StatMention[] {
  const firstWordFirst = text.search(new RegExp(String.raw`\b${WORD} ?(?:of |[:/=] ?)?(?:(?:${COMPARATIVE}) )?\d`));
  const firstNumberFirst = text.search(new RegExp(String.raw`\b(?:(?:${COMPARATIVE}) )?\d{1,5} ?(?:or \w+ |\+ ?)?(?:original )?${WORD}\b`));
  const wordFirst = firstWordFirst >= 0 && (firstNumberFirst < 0 || firstWordFirst < firstNumberFirst);
  const rules = [EQUAL_RULE, RANGE_RULE, ...(wordFirst ? WORD_FIRST : NUMBER_FIRST)];
  const found: StatMention[] = [];
  const free = (start: number, end: number) => found.every((mention) => end <= mention.start || start >= mention.end);
  for (const { pattern, make } of rules) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (free(start, end)) found.push({ start, end, stats: make(match) });
    }
  }
  return found;
}
