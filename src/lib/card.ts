/** Shared card vocabulary and the normalized card record built by `scripts/prepare-cards.ts`. */

export const CARD_KINDS = ["monster", "spell", "trap"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const ATTRIBUTES = ["DARK", "DIVINE", "EARTH", "FIRE", "LIGHT", "WATER", "WIND"] as const;
export type Attribute = (typeof ATTRIBUTES)[number];

export const MONSTER_TYPES = [
  "Aqua",
  "Beast",
  "Beast-Warrior",
  "Creator God",
  "Cyberse",
  "Dinosaur",
  "Divine-Beast",
  "Dragon",
  "Fairy",
  "Fiend",
  "Fish",
  "Illusion",
  "Insect",
  "Machine",
  "Plant",
  "Psychic",
  "Pyro",
  "Reptile",
  "Rock",
  "Sea Serpent",
  "Spellcaster",
  "Thunder",
  "Warrior",
  "Winged Beast",
  "Wyrm",
  "Zombie",
] as const;
export type MonsterType = (typeof MONSTER_TYPES)[number];

/** Card-type words that can appear on a monster's type line or as a Spell/Trap property. */
export const SUBTYPES = [
  "normal",
  "effect",
  "ritual",
  "fusion",
  "synchro",
  "xyz",
  "link",
  "pendulum",
  "tuner",
  "token",
  "flip",
  "gemini",
  "union",
  "spirit",
  "toon",
  "field",
  "equip",
  "continuous",
  "quick_play",
  "counter",
] as const;
export type Subtype = (typeof SUBTYPES)[number];

/** Master Duel's rarities as that game labels them, lowest first. */
export const MD_RARITIES = ["N", "R", "SR", "UR"] as const;
export type MasterDuelRarity = (typeof MD_RARITIES)[number];
export const MD_RARITY_NAMES: Record<MasterDuelRarity, string> = {
  N: "Normal",
  R: "Rare",
  SR: "Super Rare",
  UR: "Ultra Rare",
};

/** The paper game's two card pools, each with its own Forbidden & Limited list. */
export const GAMES = ["TCG", "OCG"] as const;
export type Game = (typeof GAMES)[number];

/** A card's place on a Forbidden & Limited list, and how many copies of it a deck may then hold. */
export const BAN_LIMITS = { Forbidden: 0, Limited: 1, "Semi-Limited": 2 } as const;
export type BanStatus = keyof typeof BAN_LIMITS;

export interface Card {
  /** Konami passcode, as used by YGOPRODeck. */
  id: number;
  /** Passcodes of the card's alternate artworks, which deck files from other apps may use instead. */
  aliases?: number[];
  name: string;
  kind: CardKind;
  /** Human-readable type line, e.g. "Tuner Effect Monster" or "Quick-Play Spell". */
  typeLine: string;
  subtypes: Subtype[];
  /** Monsters only. */
  monsterType?: string;
  attribute?: Attribute;
  level?: number;
  rank?: number;
  linkRating?: number;
  linkMarkers?: string[];
  scale?: number;
  /** `null` means "?" on the printed card. */
  atk?: number | null;
  def?: number | null;
  /** Card text. For Pendulum Monsters this is the monster effect (or flavor text) only. */
  text: string;
  pendulumText?: string;
  archetype?: string;
  /** Absent when the card is not on that game's Forbidden & Limited list. */
  banTcg?: BanStatus;
  banOcg?: BanStatus;
  /** Rarity in Master Duel; absent for cards that game does not have. */
  mdRarity?: MasterDuelRarity;
  /** What the card costs in the Genesys format (TCG list); absent for cards that cannot be played in it. */
  genesysPoints?: number;
  formats: string[];
  /** First release, as YYYY-MM-DD. */
  tcgDate?: string;
  ocgDate?: string;
  /** YGOPRODeck page views — a rough popularity signal used to break ranking ties. */
  views: number;
  url: string;
}

/** The formats a card can be legal in, as YGOPRODeck names them: the official games, then retro and fan formats. */
export const FORMATS = ["TCG", "OCG", "Master Duel", "Duel Links", "Speed Duel", "GOAT", "OCG GOAT", "Edison", "Common Charity"] as const;
export type Format = (typeof FORMATS)[number];

/**
 * When a card first came out, for the release-year filter: in the OCG for an OCG format, otherwise
 * in the TCG, or in the OCG for a card the TCG never had.
 */
export const releaseDate = (card: Pick<Card, "tcgDate" | "ocgDate">, format?: string) =>
  format?.startsWith("OCG") ? card.ocgDate : (card.tcgDate ?? card.ocgDate);

/** Where a card stands in a game: not printed there, on its Forbidden & Limited list, or free to play. */
export function standingIn(card: Pick<Card, "formats" | "banTcg" | "banOcg">, game: Game): BanStatus | "Unreleased" | "Unlimited" {
  if (!card.formats.includes(game)) return "Unreleased";
  return (game === "TCG" ? card.banTcg : card.banOcg) ?? "Unlimited";
}

/** Fusion, Synchro, Xyz and Link Monsters are kept in the Extra Deck rather than the Main Deck. */
export function isExtraDeckCard(card: Pick<Card, "subtypes">): boolean {
  return card.subtypes.some((subtype) => subtype === "fusion" || subtype === "synchro" || subtype === "xyz" || subtype === "link");
}

/** Genesys does not allow Link or Pendulum Monsters at any cost. */
export function isBarredFromGenesys(card: Pick<Card, "subtypes">): boolean {
  return card.subtypes.includes("link") || card.subtypes.includes("pendulum");
}

/**
 * Trap monsters: Trap Cards that Special Summon themselves as monsters (Tiki Curse, Paleozoic, The Phantom
 * Knights). The text always says so: "Special Summon this card (in Defense Position) as a Normal Monster…".
 */
export function isTrapMonster(card: Pick<Card, "kind" | "text">): boolean {
  return card.kind === "trap" && /Special Summon this card\b[^.]*?\bas (?:a|an) (?:\w+ )?Monster\b/i.test(card.text);
}

/** Normal Monsters without a Pendulum Effect have only flavor text, so there is nothing to tag. */
export function hasNoEffectText(card: Card): boolean {
  return card.kind === "monster" && card.subtypes.includes("normal") && !card.pendulumText;
}
