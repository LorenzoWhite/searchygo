/**
 * A deck as the game defines it, and the two formats other apps exchange decks in: the .ydk file
 * (YGOPro, EDOPro, Dueling Book, YGOPRODeck and most others) and the YDKe link (the same deck as
 * one line of text, for the clipboard). Everything here is plain data in and out, so it runs the
 * same in the browser and in a script.
 */
import { BAN_LIMITS, GAMES, isBarredFromGenesys, isExtraDeckCard, MD_RARITIES, standingIn, type Card, type Game, type MasterDuelRarity } from "./card.ts";

export const SECTIONS = ["main", "extra", "side"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_NAMES: Record<Section, string> = { main: "Main Deck", extra: "Extra Deck", side: "Side Deck" };
export const SECTION_LIMITS: Record<Section, { min: number; max: number }> = {
  main: { min: 40, max: 60 },
  extra: { min: 0, max: 15 },
  side: { min: 0, max: 15 },
};
/** A deck may hold this many of one card, counted across all three sections. */
export const MAX_COPIES = 3;
/** The standard Genesys point cap, which covers the Main, Extra and Side Deck together. */
export const GENESYS_CAP = 100;

/** Card passcodes, one entry per copy. */
export type DeckList = Record<Section, number[]>;
export interface Deck extends DeckList {
  name: string;
}

export const EMPTY_DECK: Deck = { name: "", main: [], extra: [], side: [] };

export const deckSize = (deck: DeckList) => deck.main.length + deck.extra.length + deck.side.length;
export const copiesIn = (deck: DeckList, id: number, section: Section) => deck[section].filter((other) => other === id).length;
export const copiesOf = (deck: DeckList, id: number) => SECTIONS.reduce((sum, section) => sum + copiesIn(deck, id, section), 0);

/** Where a card goes when it is added without saying where. */
export const homeSection = (card: Pick<Card, "subtypes">): Section => (isExtraDeckCard(card) ? "extra" : "main");

/** Why a copy of the card cannot go in that section, or null when it can. */
export function whyNot(deck: DeckList, card: Pick<Card, "id" | "subtypes">, section: Section): string | null {
  if (copiesOf(deck, card.id) >= MAX_COPIES) return `A deck can hold ${MAX_COPIES} copies of a card`;
  if (section !== "side" && section !== homeSection(card)) return `This card belongs in the ${SECTION_NAMES[homeSection(card)]}`;
  if (deck[section].length >= SECTION_LIMITS[section].max) return `The ${SECTION_NAMES[section]} is full`;
  return null;
}

export function addCopy<D extends DeckList>(deck: D, id: number, section: Section): D {
  return { ...deck, [section]: [...deck[section], id] };
}

/** Takes one copy out of a section; the deck comes back unchanged if there is none there. */
export function removeCopy<D extends DeckList>(deck: D, id: number, section: Section): D {
  const at = deck[section].lastIndexOf(id);
  return at === -1 ? deck : { ...deck, [section]: deck[section].filter((_, index) => index !== at) };
}

export function moveCopy<D extends DeckList>(deck: D, id: number, from: Section, to: Section): D {
  return copiesIn(deck, id, from) ? addCopy(removeCopy(deck, id, from), id, to) : deck;
}

/** A card the deck holds more copies of than a game allows. */
export interface Breach {
  card: Card;
  copies: number;
  allowed: number;
  standing: ReturnType<typeof standingIn>;
}

export interface DeckSummary {
  /** In each game, the cards that game does not have or whose list allows fewer copies than the deck holds. */
  breaches: Record<Game, Breach[]>;
  /** Genesys points across all three sections. */
  genesysPoints: number;
  /** Copies of cards Genesys does not allow at all. */
  genesysBarred: number;
  /** Copies by Master Duel rarity, and copies of cards that game does not have. */
  rarities: Record<MasterDuelRarity, number>;
  notInMasterDuel: number;
  /** Main Deck copies by kind. */
  monsters: number;
  spells: number;
  traps: number;
}

export function summarize(deck: DeckList, cards: ReadonlyMap<number, Card>): DeckSummary {
  const summary: DeckSummary = {
    breaches: { TCG: [], OCG: [] },
    genesysPoints: 0,
    genesysBarred: 0,
    rarities: Object.fromEntries(MD_RARITIES.map((rarity) => [rarity, 0])) as Record<MasterDuelRarity, number>,
    notInMasterDuel: 0,
    monsters: 0,
    spells: 0,
    traps: 0,
  };
  for (const section of SECTIONS) {
    for (const id of deck[section]) {
      const card = cards.get(id);
      if (!card) continue;
      summary.genesysPoints += card.genesysPoints ?? 0;
      if (isBarredFromGenesys(card)) summary.genesysBarred += 1;
      if (card.mdRarity) summary.rarities[card.mdRarity] += 1;
      else summary.notInMasterDuel += 1;
      if (section === "main") summary[card.kind === "monster" ? "monsters" : card.kind === "spell" ? "spells" : "traps"] += 1;
    }
  }

  // A list counts every copy of a card, whichever section it sits in.
  const copies = new Map<number, number>();
  for (const section of SECTIONS) for (const id of deck[section]) copies.set(id, (copies.get(id) ?? 0) + 1);
  for (const [id, held] of copies) {
    const card = cards.get(id);
    if (!card) continue;
    for (const game of GAMES) {
      const standing = standingIn(card, game);
      const allowed = standing === "Unlimited" ? MAX_COPIES : standing === "Unreleased" ? 0 : BAN_LIMITS[standing];
      if (held > allowed) summary.breaches[game].push({ card, copies: held, allowed, standing });
    }
  }
  for (const game of GAMES) summary.breaches[game].sort((a, b) => a.allowed - b.allowed || a.card.name.localeCompare(b.card.name));
  return summary;
}

const KIND_ORDER = { monster: 0, spell: 1, trap: 2 } as const;
const EXTRA_ORDER = ["fusion", "synchro", "xyz", "link"] as const;

/** The order a deck is read in: monsters, Spells, Traps; the Extra Deck by summoning method; then by name. */
export function compareCards(a: Card, b: Card): number {
  const extraRank = (card: Card) => EXTRA_ORDER.findIndex((subtype) => card.subtypes.includes(subtype));
  return (
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    extraRank(a) - extraRank(b) ||
    (b.level ?? b.rank ?? b.linkRating ?? 0) - (a.level ?? a.rank ?? a.linkRating ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

/** A section as distinct cards with how many copies of each, in reading order. Unknown passcodes are left out. */
export function stacks(ids: number[], cards: ReadonlyMap<number, Card>): { card: Card; copies: number }[] {
  const counts = new Map<number, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts]
    .flatMap(([id, copies]) => {
      const card = cards.get(id);
      return card ? [{ card, copies }] : [];
    })
    .sort((a, b) => compareCards(a.card, b.card));
}

// --- .ydk ---------------------------------------------------------------------------------------

/** The .ydk file: one passcode per line under `#main`, `#extra` and `!side`. */
export function toYdk(deck: DeckList, createdBy = "Search YGO (searchygo.com)"): string {
  return [`#created by ${createdBy}`, "#main", ...deck.main, "#extra", ...deck.extra, "!side", ...deck.side, ""].join("\n");
}

/** Reads a .ydk file. Returns null when the text has none of the section headings. */
export function parseYdk(text: string): DeckList | null {
  const list: DeckList = { main: [], extra: [], side: [] };
  let section: Section | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().toLowerCase();
    if (line === "#main") section = "main";
    else if (line === "#extra") section = "extra";
    else if (line === "!side") section = "side";
    else if (section && /^\d+$/.test(line)) list[section].push(Number(line));
  }
  return section ? list : null;
}

// --- YDKe ---------------------------------------------------------------------------------------

const YDKE = "ydke://";

/** Passcodes as the YDKe link stores them: 32-bit little-endian numbers, base64-encoded. */
function encodePasscodes(ids: number[]): string {
  const bytes = new Uint8Array(ids.length * 4);
  const view = new DataView(bytes.buffer);
  ids.forEach((id, index) => view.setUint32(index * 4, id, true));
  return btoa(String.fromCharCode(...bytes));
}

function decodePasscodes(encoded: string): number[] {
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return Array.from({ length: Math.floor(bytes.length / 4) }, (_, index) => view.getUint32(index * 4, true));
}

/** The YDKe link: `ydke://<main>!<extra>!<side>!`. */
export function toYdke(deck: DeckList): string {
  return `${YDKE}${SECTIONS.map((section) => encodePasscodes(deck[section])).join("!")}!`;
}

/** Reads a YDKe link. Returns null when the text is not one. */
export function parseYdke(text: string): DeckList | null {
  const link = text.trim();
  if (!link.toLowerCase().startsWith(YDKE)) return null;
  const parts = link.slice(YDKE.length).split("!");
  if (parts.length < 3) return null;
  try {
    const [main, extra, side] = parts.map(decodePasscodes) as [number[], number[], number[]];
    return { main, extra, side };
  } catch {
    return null;
  }
}

/** Reads a deck from pasted text or a file's contents, in either format. */
export const parseDeck = (text: string): DeckList | null => parseYdke(text) ?? parseYdk(text);
