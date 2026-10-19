/** Normalizes the raw YGOPRODeck dump (data/raw/cardinfo.json) into data/cards.json. */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import {
  ATTRIBUTES,
  BAN_LIMITS,
  MONSTER_TYPES,
  SUBTYPES,
  isBarredFromGenesys,
  type Attribute,
  type BanStatus,
  type Card,
  type CardKind,
  type MasterDuelRarity,
  type Subtype,
} from "../src/lib/card.ts";
import type { SetEntry, SetsFile } from "../src/lib/sets.ts";
import { CARDS_PATH, RAW_CARDS_PATH, RAW_SETS_PATH, SETS_PATH } from "./paths.ts";

interface RawCard {
  id: number;
  name: string;
  type: string;
  humanReadableCardType: string;
  frameType: string;
  desc: string;
  pend_desc?: string;
  monster_desc?: string;
  race: string;
  typeline?: string[];
  attribute?: string;
  level?: number;
  linkval?: number;
  linkmarkers?: string[];
  scale?: number;
  atk?: number;
  def?: number | null;
  archetype?: string;
  ygoprodeck_url: string;
  card_images?: { id: number }[];
  card_sets?: { set_name: string; set_code: string }[];
  banlist_info?: { ban_tcg?: string; ban_ocg?: string };
  misc_info?: {
    views?: number;
    formats?: string[];
    tcg_date?: string;
    ocg_date?: string;
    question_atk?: number;
    question_def?: number;
    md_rarity?: string;
    genesys_points?: number;
    /** Konami's own database number; only official cards have one. */
    konami_id?: number;
  }[];
}

// Speed Duel Skill Cards and Tokens are not cards you search effects for.
const SKIPPED_FRAMES = new Set(["skill", "token"]);
// A card with no formats has not been released. It is kept when Konami has it in its database, as a
// card announced but not yet out ("Mind Scan" before its set), and left out otherwise, as an anime,
// manga or placeholder entry.
const isOfficial = (card: RawCard) => (card.misc_info?.[0]?.formats?.length ?? 0) > 0 || card.misc_info?.[0]?.konami_id != null;

const warnings: string[] = [];

const subtypeSet = new Set<string>(SUBTYPES);
const monsterTypeSet = new Set<string>(MONSTER_TYPES);
const attributeSet = new Set<string>(ATTRIBUTES);

// YGOPRODeck spells the rarities out, and calls Master Duel's "N" Common.
const MD_RARITY_CODES: Record<string, MasterDuelRarity> = { Common: "N", Rare: "R", "Super Rare": "SR", "Ultra Rare": "UR" };

const cleanText = (text: string) => text.replace(/\r\n?/g, "\n").trim();
const toSubtype = (word: string) => word.toLowerCase().replace(/[- ]/g, "_");

function normalize(raw: RawCard): Card {
  const kind: CardKind =
    raw.frameType === "spell" ? "spell" : raw.frameType === "trap" ? "trap" : "monster";
  const misc = raw.misc_info?.[0] ?? {};

  const card: Card = {
    id: raw.id,
    name: raw.name,
    kind,
    typeLine: raw.humanReadableCardType,
    subtypes: [],
    text: cleanText(raw.monster_desc ?? raw.desc),
    formats: misc.formats ?? [],
    views: misc.views ?? 0,
    url: raw.ygoprodeck_url,
  };

  if (kind === "monster") {
    const words = (raw.typeline ?? []).filter((word) => word !== raw.race);
    card.subtypes = words.map(toSubtype).filter((w): w is Subtype => subtypeSet.has(w));
    const unknown = words.filter((word) => !subtypeSet.has(toSubtype(word)));
    if (unknown.length) throw new Error(`${raw.name}: unknown type-line words ${unknown.join(", ")}`);
    // Brand-new cards occasionally arrive from the API before their Type is filled in.
    if (monsterTypeSet.has(raw.race)) card.monsterType = raw.race;
    else if (raw.race === "") warnings.push(`${raw.name}: monster Type missing in source data`);
    else throw new Error(`${raw.name}: unknown monster Type ${raw.race}`);

    if (raw.attribute) {
      if (!attributeSet.has(raw.attribute)) throw new Error(`${raw.name}: unknown attribute ${raw.attribute}`);
      card.attribute = raw.attribute as Attribute;
    }
    // YGOPRODeck stores an Xyz Monster's Rank in `level`.
    if (card.subtypes.includes("xyz")) card.rank = raw.level;
    else if (!card.subtypes.includes("link")) card.level = raw.level;
    if (raw.linkval != null) card.linkRating = raw.linkval;
    if (raw.linkmarkers) card.linkMarkers = raw.linkmarkers;
    if (raw.scale != null) card.scale = raw.scale;
    card.atk = misc.question_atk ? null : (raw.atk ?? null);
    if (!card.subtypes.includes("link")) card.def = misc.question_def ? null : (raw.def ?? null);
    if (raw.pend_desc) card.pendulumText = cleanText(raw.pend_desc);
  } else {
    const property = toSubtype(raw.race || raw.humanReadableCardType.split(" ")[0]!);
    if (!subtypeSet.has(property)) throw new Error(`${raw.name}: unknown ${kind} property ${raw.race}`);
    card.subtypes = [property as Subtype];
  }

  const aliases = (raw.card_images ?? []).map((image) => image.id).filter((id) => id !== raw.id);
  if (aliases.length) card.aliases = aliases;
  if (raw.archetype) {
    // A stray wiki template line ("| supports_archetypes    Power Patron") has turned up as an archetype;
    // the archetype is the name at its end.
    const template = /^\|\s*\w+\s+(.+)$/.exec(raw.archetype);
    if (template) warnings.push(`${raw.name}: archetype "${raw.archetype}" read as "${template[1]}"`);
    card.archetype = template ? template[1]!.trim() : raw.archetype;
  }
  const banStatus = (status: string | undefined): BanStatus | undefined => {
    if (status && !(status in BAN_LIMITS)) throw new Error(`${raw.name}: unknown Forbidden & Limited status ${status}`);
    return status as BanStatus | undefined;
  };
  const [banTcg, banOcg] = [banStatus(raw.banlist_info?.ban_tcg), banStatus(raw.banlist_info?.ban_ocg)];
  if (banTcg) card.banTcg = banTcg;
  if (banOcg) card.banOcg = banOcg;
  if (misc.tcg_date) card.tcgDate = misc.tcg_date;
  if (misc.ocg_date) card.ocgDate = misc.ocg_date;
  if (misc.md_rarity) {
    const rarity = MD_RARITY_CODES[misc.md_rarity];
    if (!rarity) throw new Error(`${raw.name}: unknown Master Duel rarity ${misc.md_rarity}`);
    card.mdRarity = rarity;
  }
  // The points are the TCG's list, so a card not yet printed there only counts once it has been given a cost.
  const points = misc.genesys_points;
  if (points != null && !isBarredFromGenesys(card) && (card.formats.includes("TCG") || points > 0)) {
    card.genesysPoints = points;
  }
  return card;
}

const raw = JSON.parse(await fs.readFile(RAW_CARDS_PATH, "utf8")) as { data: RawCard[] };
const cards = raw.data
  .filter((card) => !SKIPPED_FRAMES.has(card.frameType) && isOfficial(card))
  .map(normalize)
  .sort((a, b) => a.id - b.id);

await fs.writeFile(CARDS_PATH, JSON.stringify(cards));

// --- Sets: which TCG sets each card was printed in, kept apart from the cards so search results stay small.
const setInfo = new Map<string, { code: string; date?: string }>();
if (existsSync(RAW_SETS_PATH)) {
  for (const set of JSON.parse(await fs.readFile(RAW_SETS_PATH, "utf8")) as { set_name: string; set_code: string; tcg_date?: string }[]) {
    setInfo.set(set.set_name, { code: set.set_code, date: set.tcg_date });
  }
}
const kept = new Set(cards.map((card) => card.id));
const setNames = new Map<string, number>();
const setsOfCard: Record<number, number[]> = {};
const setList: SetEntry[] = [];
for (const card of raw.data) {
  if (!kept.has(card.id)) continue;
  const indexes = new Set<number>();
  for (const printing of card.card_sets ?? []) {
    let index = setNames.get(printing.set_name);
    if (index === undefined) {
      const info = setInfo.get(printing.set_name);
      index = setList.push({ name: printing.set_name, code: info?.code ?? printing.set_code.split("-")[0]!, date: info?.date, cards: 0 }) - 1;
      setNames.set(printing.set_name, index);
    }
    indexes.add(index);
  }
  for (const index of indexes) setList[index]!.cards++;
  if (indexes.size) setsOfCard[card.id] = [...indexes];
}
await fs.writeFile(SETS_PATH, JSON.stringify({ sets: setList, cards: setsOfCard } satisfies SetsFile));
console.log(`Wrote ${setList.length} sets to ${SETS_PATH}`);

const byKind = Object.groupBy(cards, (card) => card.kind);
console.log(
  `Wrote ${cards.length} cards to ${CARDS_PATH} ` +
    `(${byKind.monster?.length} monsters, ${byKind.spell?.length} spells, ${byKind.trap?.length} traps; ` +
    `skipped ${raw.data.length - cards.length} Skill Cards, Tokens and unreleased cards)`,
);
for (const warning of warnings) console.warn(`warning: ${warning}`);
