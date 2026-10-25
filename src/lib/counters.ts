/**
 * Counters: which cards stop an archetype ("how to beat Tearlaments").
 *
 * A model reads an archetype's cards once (`scripts/profile-archetypes.ts --job counters`) and writes
 * a `CounterProfile`: what the deck relies on, each reliance as a weakness that the card tags can be
 * searched for, plus the cards players actually side against it. The weaknesses use the synergy hook
 * format, seen from the other side of the table: the outside card acts on the opponent's cards.
 *
 * Two things set counters apart from synergy. The tags record that Ash Blossom answers an
 * activation but not which ones, so a weakness can also ask for roles ("gy_hate") and printed
 * phrases ("from the Deck to the hand"), and the profile names the well-known answers outright.
 * And the generic answers are often the right ones, so no weakness is thrown away for being common;
 * the well-known cards simply come first within it.
 */
import * as z from "zod";
import type { Card } from "./card.ts";
import { matchCard } from "./effect-match.ts";
import { Hook, belongsTo, hookQuery, readHook, worldOf, type Candidate } from "./synergy.ts";
import { ROLES, type CardTags } from "./tags.ts";

const ROLE_NAMES = Object.keys(ROLES) as [keyof typeof ROLES, ...(keyof typeof ROLES)[]];

/** When an answer is played: before the deck's combo (hand traps, floodgates) or after it (breakers). */
export const TIMINGS = ["going_first", "going_second", "either"] as const;
export type Timing = (typeof TIMINGS)[number];

export const Weakness = Hook.extend({
  label: z.string().describe("Two to five words naming what the deck relies on, as a player would say it"),
  why: z.string().describe("One sentence: which of its cards rely on it, and how an answer stops them"),
  when: z.enum(TIMINGS).describe("going_first: stops the combo before it ends; going_second: breaks the board it ends on"),
  roles: z.array(z.enum(ROLE_NAMES)).describe("Roles the answering card must all have"),
});
export type Weakness = z.infer<typeof Weakness>;

export const Answer = z.object({
  name: z.string().describe("The exact name of a card players use against this deck"),
  why: z.string().describe("One sentence: what it stops"),
  when: z.enum(TIMINGS),
});
export type Answer = z.infer<typeof Answer>;

export const CounterProfile = z.object({
  plan: z.string().describe("One sentence on how the deck wins: what it sets up and what it ends on"),
  weaknesses: z.array(Weakness),
  answers: z.array(Answer),
});
export type CounterProfile = z.infer<typeof CounterProfile>;

/** A line of data/counters/profiles.jsonl. */
export interface CounteredArchetype {
  archetype: string;
  cards: number;
  model: string;
  effort?: string;
  profile: CounterProfile;
}

export const MAX_WEAKNESSES = 6;
export const MAX_ANSWERS = 8;
/** A weakness more cards than this answer ("removes a monster") says nothing in particular, and is not used. */
const TOO_BROAD = 1000;

const plainName = (name: string) => name.toLowerCase().replaceAll("&", "and").replace(/[^a-z0-9]+/g, "");

/** How many single-letter edits turn one string into the other. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * Looks a card up by the name a model wrote, forgiving punctuation and a slip of a letter or two
 * ("Rivalry of Warlands"). A guess further off than that is more likely a different card, so it is
 * not taken.
 */
export function cardNamedLike(cards: readonly Card[]): (name: string) => Card | undefined {
  const byPlain = new Map(cards.map((card) => [plainName(card.name), card]));
  return (name) => {
    const plain = plainName(name);
    if (!plain) return undefined;
    const exact = byPlain.get(plain);
    if (exact) return exact;
    const allowed = plain.length >= 12 ? 2 : 1;
    let best: { card: Card; distance: number } | undefined;
    for (const [other, card] of byPlain) {
      if (Math.abs(other.length - plain.length) > allowed) continue;
      const distance = editDistance(plain, other);
      if (distance <= allowed && (!best || distance < best.distance)) best = { card, distance };
    }
    if (best) return best.card;
    // A slip in the last word ("Ghost Belle & Haunted Doll", "Rivalry of Warriors") still points to one
    // card when every word before it begins only that card's name.
    const words = name.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length < 3) return undefined;
    const opening = plainName(words.slice(0, -1).join(" "));
    const matches = [...byPlain].filter(([other]) => other.startsWith(opening));
    return matches.length === 1 ? matches[0]![1] : undefined;
  };
}

// --- Reading a model's reply -------------------------------------------------------------------

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const timing = (value: unknown): Timing => (TIMINGS as readonly unknown[]).includes(value) ? (value as Timing) : "either";

function readRoles(value: unknown): Weakness["roles"] | null {
  const roles: Weakness["roles"] = [];
  for (const item of asList(value)) {
    const role = typeof item === "string" ? ROLE_NAMES.find((name) => name === item.toLowerCase().replace(/[- ]/g, "_")) : undefined;
    if (!role) return null;
    roles.push(role);
  }
  return roles;
}

/**
 * Reads a counter profile from a model's reply. Named answers are kept only when they are real cards
 * from outside the archetype, under their exact names. Returns null when there is no plan or nothing
 * to search for.
 */
export function readCounterProfile(
  reply: unknown,
  archetype: string,
  cardNamed: (name: string) => Card | undefined,
): { profile: CounterProfile; dropped: string[] } | null {
  const given = asObject(reply);
  const plan = text(given?.plan);
  if (!given || !plan) return null;

  const weaknesses: Weakness[] = [];
  const dropped: string[] = [];
  for (const raw of asList(given.weaknesses)) {
    const fields = asObject(raw);
    const roles = readRoles(fields?.roles);
    if (!roles) {
      dropped.push(`"${text(fields?.label)}" uses a role outside the vocabulary`);
      continue;
    }
    const hook = readHook(raw, archetype, roles.length > 0);
    if (typeof hook === "string") dropped.push(hook);
    else if (weaknesses.length < MAX_WEAKNESSES) weaknesses.push({ ...hook, when: timing(fields?.when), roles });
  }

  const answers: Answer[] = [];
  for (const raw of asList(given.answers)) {
    const fields = asObject(raw);
    const card = cardNamed(text(fields?.name));
    if (!card) dropped.push(`answer "${text(fields?.name)}" is not a card`);
    else if (belongsTo(card, archetype)) dropped.push(`answer "${card.name}" is one of the deck's own cards`);
    else if (answers.length < MAX_ANSWERS && !answers.some((answer) => answer.name === card.name)) {
      answers.push({ name: card.name, why: text(fields?.why), when: timing(fields?.when) });
    }
  }
  return weaknesses.length || answers.length ? { profile: { plan, weaknesses, answers }, dropped } : null;
}

// --- Finding the cards a profile describes -----------------------------------------------------

export interface WeaknessResult {
  weakness: Weakness;
  /** How many outside cards answer it. */
  matches: number;
  /** Answered by so many cards that it says nothing about any of them; it is left out of the search. */
  ignored: boolean;
}

export interface Counter {
  /** Position of the card in the list that was searched. */
  index: number;
  /** Named by the profile as an answer players use. */
  answer?: Answer;
  /** Positions in `weaknesses` of the weaknesses this card answers, in the profile's order. */
  stops: number[];
}

const fitsRoles = (tags: CardTags | undefined, roles: Weakness["roles"]) => roles.every((role) => tags?.roles.includes(role));

/**
 * Finds the cards outside an archetype that stop it.
 *
 * The answers the profile names come first, in its order. Then cards that answer several weaknesses,
 * then the weaknesses take turns, each giving its next card, so the first page covers every way to
 * stop the deck. Within a weakness the cards that fit it most exactly come first, then the
 * well-known: those are the ones players already own and trust.
 */
export function findCounters(profile: CounterProfile, archetype: string, candidates: readonly Candidate[]): { weaknesses: WeaknessResult[]; counters: Counter[] } {
  const printed = candidates.map(({ card }) => `${card.pendulumText ?? ""}\n${card.text}`.toLowerCase());
  const outside = candidates.map(({ card }) => !belongsTo(card, archetype));
  const views = (index: number) => candidates[index]!.card.views;

  const fitting = profile.weaknesses.map((weakness) => {
    const query = hookQuery(weakness, archetype);
    const phrases = weakness.phrases.map((phrase) => phrase.toLowerCase());
    const found: { index: number; specificity: number }[] = [];
    candidates.forEach(({ card, tags }, index) => {
      if (!outside[index] || !fitsRoles(tags, weakness.roles) || !phrases.every((phrase) => printed[index]!.includes(phrase))) return;
      const specificity = matchCard(card, tags, query, worldOf(candidates));
      if (specificity !== null) found.push({ index, specificity });
    });
    return found.sort((a, b) => b.specificity - a.specificity || views(b.index) - views(a.index));
  });

  const ignored = fitting.map((found) => found.length > TOO_BROAD);
  const stopsOf = new Map<number, number[]>();
  fitting.forEach((found, at) => {
    if (ignored[at]) return;
    for (const { index } of found) stopsOf.set(index, [...(stopsOf.get(index) ?? []), at]);
  });

  const byName = new Map(candidates.map(({ card }, index) => [card.name, index]));
  const counters: Counter[] = [];
  const listed = new Set<number>();
  for (const answer of profile.answers) {
    const index = byName.get(answer.name);
    if (index === undefined || listed.has(index)) continue;
    counters.push({ index, answer, stops: stopsOf.get(index) ?? [] });
    listed.add(index);
  }

  const several = [...stopsOf]
    .filter(([index, stops]) => stops.length > 1 && !listed.has(index))
    .sort(([a, stopsA], [b, stopsB]) => stopsB.length - stopsA.length || views(b) - views(a));
  for (const [index, stops] of several) {
    counters.push({ index, stops });
    listed.add(index);
  }

  const queues = fitting.map((found, at) => (ignored[at] ? [] : found.filter(({ index }) => !listed.has(index))));
  for (let turn = 0; queues.some((queue) => turn < queue.length); turn++) {
    queues.forEach((queue, at) => {
      const next = queue[turn];
      if (next && !listed.has(next.index)) {
        counters.push({ index: next.index, stops: [at] });
        listed.add(next.index);
      }
    });
  }
  return { weaknesses: profile.weaknesses.map((weakness, at) => ({ weakness, matches: fitting[at]!.length, ignored: ignored[at]! })), counters };
}
