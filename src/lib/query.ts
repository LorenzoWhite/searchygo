/**
 * Reads a plain-English search ("special summon a WATER monster from the GY", "hand traps that
 * negate", "triggers when banished") into the same vocabulary the card tags use. It is a fixed set
 * of phrase rules rather than a model call, so it costs nothing per search and always gives the
 * same reading, which the site shows back to the user.
 */
import { ATTRIBUTES, MONSTER_TYPES, type Attribute, type CardKind, type Subtype } from "./card.ts";
import { describeStats, isEmptyStats, mergeStats, statsInSearch, type StatQuery } from "./stats.ts";
import type { CardTags, GameEvent } from "./tags.ts";

type Verb = GameEvent["verb"];
type Zone = GameEvent["from"][number];
type Role = CardTags["roles"][number];

/** Which cards something applies to. Empty lists and missing bounds mean "any". */
export interface ObjectQuery {
  kinds: CardKind[];
  subtypes: Subtype[];
  types: string[];
  attributes: Attribute[];
  archetypes: string[];
  levelMin?: number;
  levelMax?: number;
  /** ATK and DEF: "2400 ATK 1000 DEF", "0 DEF", "ATK 2000 or more". */
  stats?: StatQuery;
  /** Which Deck the card goes in: "Extra Deck monsters" are Fusion, Synchro, Xyz and Link Monsters. */
  deck?: "main" | "extra";
}

export interface EventQuery {
  /** Any one of these counts. */
  verbs: Verb[];
  from: Zone[];
  player?: "you" | "opponent";
  /** The event must be about the card itself ("Special Summons itself", "when it is banished"). */
  self: boolean;
  object: ObjectQuery;
  /** "Generic": the effect must not be locked to an archetype or a named card. */
  generic?: boolean;
}

export interface EffectQuery {
  /** What the card itself must be. */
  card: ObjectQuery;
  roles: Role[];
  does?: EventQuery;
  reactsTo?: EventQuery;
  /** What the card must work with: its own archetype, or what its text names. */
  supports?: ObjectQuery;
  /** Usable during the opponent's turn. */
  quick: boolean;
  /** Where the card is when the effect is used: "GY effects", "effects while banished". */
  worksFrom?: Zone;
  /** Game terms the card's own text must use, for support of a kind of card ("Normal Monster support"). */
  mentions?: string[];
  /** "Generic": nothing in it is locked to an archetype or a named card. */
  generic?: boolean;
  /** Words the rules did not use, matched against card text. */
  text: string;
}

export interface Interpretation {
  query: EffectQuery;
  /** The reading, phrased for display. */
  chips: string[];
}

const emptyObject = (): ObjectQuery => ({ kinds: [], subtypes: [], types: [], attributes: [], archetypes: [] });

export const isEmptyObject = (object: ObjectQuery) =>
  !object.kinds.length &&
  !object.subtypes.length &&
  !object.types.length &&
  !object.attributes.length &&
  !object.archetypes.length &&
  object.levelMin === undefined &&
  object.levelMax === undefined &&
  isEmptyStats(object.stats) &&
  !object.deck;

// --- Phrase rules -----------------------------------------------------------------------------

interface VerbRule {
  pattern: RegExp;
  verbs: Verb[];
  /** Zone the phrase implies when the query names none ("search" means from the Deck). */
  from?: Zone;
  /** Resolved by where the cards go: "return ... to the hand" versus "return ... to the Deck". */
  generic?: "return" | "send" | "summon";
  /** Only meaningful as something a card reacts to ("when your opponent activates..."). */
  triggerOnly?: boolean;
  /** Always something a card reacts to, even without "when" or "if". */
  alwaysTrigger?: boolean;
}

const CANNOT = "(?:can(?:no|')?t|cannot|can not|stops?|prevents?|blocks?|locks?|restricts?)";

// Checked in order, so the specific phrasings come before the general ones they contain.
const VERB_RULES: VerbRule[] = [
  { pattern: new RegExp(`\\b${CANNOT} (?:\\w+ )?(?:be )?(?:special(?:ly)? |normal )?summon\\w*`), verbs: ["restrict_summon"] },
  { pattern: new RegExp(`\\b${CANNOT} (?:\\w+ )?activat\\w+`), verbs: ["restrict_activation"] },
  { pattern: new RegExp(`\\b${CANNOT} (?:\\w+ )?attack\\w*`), verbs: ["restrict_attack"] },
  { pattern: /\b(?:can(?:no|')?t|cannot|can not) be (?:destroyed|destroy)\b|\bindestructible\b|\b(?:immune to|protect\w* from) destruction\b|\bdestruction protection\b/, verbs: ["prevent_destruction"] },
  { pattern: /\b(?:can(?:no|')?t|cannot|can not) be target\w*|\buntargetable\b|\btargeting protection\b/, verbs: ["prevent_targeting"] },
  { pattern: /\bunaffected\b|\bimmune\b/, verbs: ["unaffected"] },

  { pattern: /\bnegat\w* (?:the |an? )?(?:special |normal )?summons?\b/, verbs: ["negate_summon"] },
  { pattern: /\bnegat\w* (?:the |an? )?attacks?\b/, verbs: ["negate_attack"] },
  { pattern: /\bnegat\w*/, verbs: ["negate_activation", "negate_effect"] },

  { pattern: /\bfusion summon\w*/, verbs: ["fusion_summon"] },
  { pattern: /\britual summon\w*/, verbs: ["ritual_summon"] },
  { pattern: /\bsynchro summon\w*/, verbs: ["synchro_summon"] },
  { pattern: /\bxyz summon\w*/, verbs: ["xyz_summon"] },
  { pattern: /\blink summon\w*/, verbs: ["link_summon"] },
  { pattern: /\bpendulum summon\w*/, verbs: ["pendulum_summon"] },
  { pattern: /\b(?:extra |additional |another |second )?(?:normal|tribute) summon\w*/, verbs: ["normal_summon"] },
  { pattern: /\bspecial(?:ly)? summon\w*|\bsp\.? summon\w*|\bcheat\w* out\b/, verbs: ["special_summon"] },
  { pattern: /\b(?:reviv\w+|reborn|resurrect\w*|reanimat\w*)/, verbs: ["special_summon"], from: "gy" },
  { pattern: /\bsummon\w*/, verbs: ["special_summon"], generic: "summon" },

  { pattern: /\b(?:search\w*|tutor\w*|fetch\w*)/, verbs: ["add_to_hand"], from: "deck" },
  { pattern: /\b(?:recover\w*|retriev\w*|salvag\w*)(?! \d* ?(?:lp|life))/, verbs: ["add_to_hand"], from: "gy" },
  { pattern: /\b(?:place\w*|put\w*|add\w*) (?:\w+ )?counters?\b/, verbs: ["place_counter"] },
  { pattern: /\badd(?:s|ed|ing)?\b/, verbs: ["add_to_hand"] },

  { pattern: /\b(?:mill\w*|foolish(?: burial)?|dump\w*)/, verbs: ["send_to_gy"], from: "deck" },
  { pattern: /\bdiscard\w*/, verbs: ["discard"] },
  { pattern: /\bdestroy\w* by battle\b|\bbattle destr\w+/, verbs: ["destroy_by_battle"] },
  { pattern: /\b(?:destroy\w*|destruction|pop(?:s|ped|ping)?)\b/, verbs: ["destroy"] },
  { pattern: /\bleav\w+ the field\b|\bleft the field\b|\bremoved from the field\b/, verbs: ["leave_field"], alwaysTrigger: true },
  { pattern: /\b(?:banish\w*|remov\w+ from play|exil\w+)/, verbs: ["banish"] },
  { pattern: /\bbounc\w+/, verbs: ["return_to_hand"] },
  { pattern: /\b(?:spin(?:s|ning)?|shuffl\w+)\b/, verbs: ["return_to_deck"] },
  { pattern: /\breturn\w*/, verbs: ["return_to_hand", "return_to_deck"], generic: "return" },
  { pattern: /\b(?:send(?:s|ing)?|sent)\b/, verbs: ["send_to_gy"], generic: "send" },

  { pattern: /\b(?:draw(?:s|ing|n)?|drew)\b/, verbs: ["draw"] },
  { pattern: /\bused as (?:\w+ )?materials?\b|\bas (?:fusion|synchro|xyz|link) materials?\b/, verbs: ["used_as_material"], alwaysTrigger: true },
  { pattern: /\bdetach\w*/, verbs: ["detach_material"] },
  { pattern: /\battach\w*/, verbs: ["attach_material"] },
  { pattern: /\btribut\w+/, verbs: ["tribute"] },
  { pattern: /\b(?:tak\w+|gain\w*|chang\w+|switch\w*) control\b|\b(?:steal\w*|snatch\w*)/, verbs: ["take_control"] },
  { pattern: /\b(?:inflict\w*|deal\w*) (?:\w+ )?(?:effect )?damage\b|\beffect damage\b/, verbs: ["inflict_damage"] },
  { pattern: /\b(?:gain\w*|recover\w*|restor\w*) (?:\d+ )?(?:lp|life(?: points?)?)\b|\blife gain\b|\bheal\w*/, verbs: ["gain_lp"] },
  { pattern: /\bpay\w* (?:\d+ |half )?(?:your )?(?:lp|life(?: points?)?)\b/, verbs: ["pay_lp"] },
  { pattern: /\b(?:gain\w*|boost\w*|increas\w*|rais\w*|doubl\w*|los\w+|reduc\w*|lower\w*|halv\w*) (?:\w+ )?(?:atk|attack|def|defense)\b|\b(?:atk|attack) (?:boost|gain|increase|reduction)\w*/, verbs: ["change_atk_def"] },
  { pattern: /\bpiercing\b/, verbs: ["piercing"] },
  { pattern: /\bdirect attack\w*|\battack\w* directly\b/, verbs: ["attack_directly"] },
  { pattern: /\battack\w* (?:twice|again|multiple times|all monsters|every monster)\b|\b(?:double|multiple|second|extra) attacks?\b/, verbs: ["attack_again"] },
  { pattern: /\bexcavat\w+/, verbs: ["excavate"] },
  { pattern: /\b(?:reveal\w*|look\w* at|peek\w*)/, verbs: ["reveal_or_look"] },
  { pattern: /\bequip(?:s|ped|ping)?\b(?! (?:spell|card))/, verbs: ["equip"] },
  { pattern: /\bset(?:s|ting)?\b(?= (?:\w+ ){0,3}(?:spell|trap|backrow))/, verbs: ["set_spell_trap"] },
  { pattern: /\b(?:chang\w+|modulat\w+) (?:the |its |their )?levels?\b|\blevel modulation\b/, verbs: ["change_level"] },
  { pattern: /\bflip(?:s|ped|ping)? (?:it |them |a monster |monsters )?face[- ]down\b|\bface[- ]down\b/, verbs: ["change_position"] },
  { pattern: /\bflip(?:s|ped|ping)?\b/, verbs: ["flip"], triggerOnly: true },
  { pattern: /\bcop(?:y|ies|ying|ied)\b/, verbs: ["copy_effect"] },
  { pattern: /\bwin\w* the duel\b/, verbs: ["win_duel"] },
  { pattern: /\bactivat\w+/, verbs: ["activate"], triggerOnly: true },
  { pattern: /\b(?:declar\w+ an attack|attack(?:s|ed|ing)?)\b/, verbs: ["attack"], triggerOnly: true },
  { pattern: /\bbattl(?:e|es|ed|ing)\b/, verbs: ["battle"], triggerOnly: true },
];

const ROLE_RULES: [RegExp, Role][] = [
  [/\bhand ?traps?\b/, "hand_trap"],
  [/\btrap[- ]monsters?\b/, "trap_monster"],
  [/\bfloodgates?\b|\blockdown\b/, "floodgate"],
  [/\bboard ?breakers?\b|\bgoing second\b/, "board_breaker"],
  [/\b(?:board|field) ?wipes?\b|\bmass removal\b|\bnukes?\b/, "mass_removal"],
  [/\bbackrow (?:removal|hate)\b|\bspell ?\/? ?trap removal\b/, "backrow_removal"],
  [/\bsearchers?\b/, "searcher"],
  [/\bextenders?\b/, "extender"],
  [/\bgy hate\b|\banti[- ]gy\b/, "gy_hate"],
  [/\bhand (?:disruption|rip|destruction)\b/, "hand_disruption"],
  [/\bdraw (?:power|engine)s?\b/, "draw_power"],
  [/\b(?:alternate|alternative|alt|instant) win(?: conditions?)?\b|\bwin conditions?\b/, "alternate_win"],
  [/\bbattle tricks?\b/, "battle_trick"],
  [/\bstat (?:boost|change)\w*\b/, "stat_change"],
  [/\btoken generators?\b/, "token_generator"],
  [/\bomni[- ]?negates?\b/, "negation"],
  [/\b(?:spot )?removal\b/, "removal"],
  [/\bdisruptions?\b|\binterruptions?\b/, "disruption"],
  [/\bprotection\b/, "protection"],
  [/\brecursion\b/, "recursion"],
  [/\bstall\b/, "stall"],
  [/\bburn\b/, "burn"],
];

const ZONE_WORDS: [RegExp, Zone][] = [
  [/^(?:main )?deck$/, "deck"],
  [/^hand$/, "hand"],
  [/^gy$/, "gy"],
  [/^extra(?: deck)?$/, "extra_deck"],
  [/^banish|^removed/, "banished"],
  [/^field$/, "field"],
  [/^pendulum|^scale/, "pendulum_zone"],
];
const ZONE = "(main deck|deck|hand|gy|extra deck|extra|banish(?:ed|ment)?(?: zone| pile)?|removed from play|field|pendulum zone|scales?)";
const OWNER = "(?:(opponent'?s?|opponents'|opp'?s?|their|enemy'?s?|either(?: player'?s?)?|your own|your|my|its|the|an?) )?";
const FROM_ZONE = new RegExp(`\\b(?:from|in|inside|on) ${OWNER}${OWNER}${ZONE}\\b`);
const TO_ZONE = new RegExp(`\\b(?:in)?to (?:the |your |my |their |its owner'?s? |either )?(?:(?:top|bottom) of (?:the |your )?)?(hand|gy|deck|extra deck|field)\\b`);
const BANISHED_NOUN = /\bbanished(?= (?:cards?|monsters?|spells?|traps?)\b)/;

const OPPONENT = /\b(?:opponent'?s?|opponents'|opp'?s?|their|enemy'?s?)\b/;
const YOURS = /\b(?:your own|my own|my|mine|own)\b/;
const SELF = /\b(?:itself|themselves|this card|its own self)\b/;
/**
 * An effect used from somewhere other than the field: "GY effects", "effects in the hand",
 * "activates from the GY", "while banished". The zone is in the second group.
 */
const WORKS_FROM =
  /\b((?:gy|hand|banished|banishment) effects?|effects? (?:that (?:work|activate|apply) )?(?:in|from|while in) (?:the |your )?(gy|hand)|(?:activates?|usable|works?|used) (?:from|in) (?:the |your )?(gy|hand)|while (?:in (?:the |your )?(gy|hand)|(banished)))\b/;
const QUICK = /\bquick effects?\b|\bspell speed 2\b|\b(?:during|on|in) (?:the |my |your )?(?:opponent'?s?|either(?: player'?s?)?) turns?\b/;
const SUPPORT = /\bsupports?\b|\b(?:works?|good|goes|synerg\w+) (?:well )?(?:with|in|for)(?= )/;
const CUE = /\b(?:when(?:ever)?|if|upon|after|every time|each time|triggers?(?: when| if| on)?|reacts? to|responds? to|in response to|benefits? from|rewards?|punish(?:es)?)\b|\bon(?= (?:summon|being|normal|special|flip|destruction|leaving))/;
const AUXILIARY = /\b(?:is|are|gets?|got|being|been|was|were)\b/;
const BOUNDARY = /[,;:]|\bthen\b|\byou can\b/;

const LEVEL_RULES: [RegExp, (n: number) => Pick<ObjectQuery, "levelMin" | "levelMax">][] = [
  [/\b(?:level|lvl?\.?) ?(\d{1,2}) (?:or|and) (?:lower|less|below|under)\b/, (n) => ({ levelMax: n })],
  [/\b(?:level|lvl?\.?) ?(\d{1,2}) (?:or|and) (?:higher|more|above|over|greater)\b/, (n) => ({ levelMin: n })],
  [/\b(?:level|lvl?\.?|rank|link) ?(\d{1,2})\b/, (n) => ({ levelMin: n, levelMax: n })],
];

/** "Extra Deck monsters", "ED monsters", "Main Deck monsters": a card's Deck, said before what it is. */
const DECK_RULES: [RegExp, "main" | "extra"][] = [
  [/\b(?:extra deck|ed)(?= (?:[\w-]+ ){0,3}(?:monsters?|cards?)\b)/, "extra"],
  [/\bmain deck(?= (?:[\w-]+ ){0,3}(?:monsters?|cards?)\b)/, "main"],
];

const KIND_RULES: [RegExp, CardKind[]][] = [
  [/\bbackrow\b|\bs\/t\b|\bspells? (?:and|or|\/) ?traps?\b/, ["spell", "trap"]],
  [/\bmonsters?\b/, ["monster"]],
  [/\bspells?\b/, ["spell"]],
  [/\btraps?\b/, ["trap"]],
];

const SUBTYPE_RULES: [RegExp, Subtype, CardKind?][] = [
  [/\bfield spells?\b/, "field", "spell"],
  [/\bquick[- ]?plays?(?: spells?)?\b/, "quick_play", "spell"],
  [/\bequip (?:spells?|cards?)\b/, "equip", "spell"],
  [/\bcounter traps?\b/, "counter", "trap"],
  [/\bcontinuous\b/, "continuous"],
  [/\b(?:normal monsters?|vanillas?)\b/, "normal", "monster"],
  [/\beffect monsters?\b/, "effect", "monster"],
  [/\btuners?\b/, "tuner"],
  [/\bxyz\b/, "xyz"],
  [/\bsynchros?\b/, "synchro"],
  [/\bfusions?\b/, "fusion"],
  [/\blinks?\b/, "link"],
  [/\brituals?\b/, "ritual"],
  [/\bpendulums?\b/, "pendulum"],
  [/\btokens?\b/, "token"],
  [/\bflip monsters?\b/, "flip", "monster"],
  [/\bunions?\b/, "union"],
  [/\bspirits?\b/, "spirit"],
  [/\bgeminis?\b/, "gemini"],
];

const typePattern = (type: string) => {
  const base = type.toLowerCase().replace(/[- ]/g, "[- ]?");
  if (type === "Fairy") return /\bfair(?:y|ies)\b/;
  if (type === "Fish") return /\bfish(?:es)?\b/;
  if (type === "Dinosaur") return /\bdino(?:saur)?s?\b/;
  return new RegExp(`\\b${base}s?\\b`);
};
// Longest first, so "Beast-Warrior" is not read as "Beast" plus "Warrior".
const TYPE_RULES: [RegExp, string][] = [...MONSTER_TYPES].sort((a, b) => b.length - a.length).map((type) => [typePattern(type), type]);
const ATTRIBUTE_RULES: [RegExp, Attribute][] = ATTRIBUTES.map((attribute) => [new RegExp(`\\b${attribute.toLowerCase()}\\b`), attribute]);

/** Archetype names that are also ordinary words in a search, so they are only matched as text. */
const AMBIGUOUS_ARCHETYPES = new Set(
  `anti attraction bonding butterfly celebration change chaos circular clear contact corn counter cupid death demise dice doll
   empower fairy favorite forbidden fusion garbage greed guardian hazy heart herald heroic hole jar king knight link magnet
   majestic mask mischief moth motor nimble number overlay parasite pendulum polymerization possessed priestess puppet
   recipe relinquished rites ritual rose royal saber season seventh star swamp synchro teleport test toy train underworld
   vassal void warrior white worm xyz`.split(/\s+/),
);

/** Words that carry no meaning for matching card text once the rules have taken what they understand. */
const FILLER = new Set(
  `a an and any all are as at be by can card cards do does effect effects find for from get gets give gives has have i in is
   it its let lets me my of on one or own show some that the their them these they this those to up use uses using want
   which who whose with you your 1 been being was were when if into onto also each every than then while work works mention mentions mentioning`.split(/\s+/),
);

// --- Interpreter ------------------------------------------------------------------------------

type MarkType =
  | "verb" | "role" | "where" | "generic" | "stat" | "deck" | "from" | "to" | "opponent" | "yours" | "self" | "quick" | "support" | "cue" | "boundary"
  | "level" | "kind" | "subtype" | "type" | "attribute" | "archetype";

interface Mark {
  type: MarkType;
  start: number;
  end: number;
  rule?: VerbRule;
  role?: Role;
  zone?: Zone;
  opponent?: boolean;
  level?: Pick<ObjectQuery, "levelMin" | "levelMax">;
  stats?: StatQuery;
  deck?: "main" | "extra";
  kinds?: CardKind[];
  subtype?: Subtype;
  monsterType?: string;
  attribute?: Attribute;
  archetype?: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toZone = (word: string) => ZONE_WORDS.find(([pattern]) => pattern.test(word))?.[1];

/** Words the other rules already give a meaning to: "Dark Tuner" is read as DARK plus Tuner, not as the archetype. */
const VOCABULARY_WORDS = new Set([
  ...ATTRIBUTES.map((attribute) => attribute.toLowerCase()),
  ...MONSTER_TYPES.flatMap((type) => type.toLowerCase().split(/[- ]/)),
  ..."monster spell trap tuner xyz synchro fusion link ritual pendulum token normal effect field equip continuous counter flip union spirit gemini".split(" "),
]);

export function buildArchetypeMatcher(names: Iterable<string>): (text: string) => { name: string; start: number; end: number }[] {
  const byKey = new Map<string, string>();
  for (const name of names) {
    const key = name.toLowerCase();
    const ordinary = key.split(/[- ]+/).every((word) => VOCABULARY_WORDS.has(word) || AMBIGUOUS_ARCHETYPES.has(word));
    if (key.length >= 3 && !ordinary) byKey.set(key, name);
  }
  if (!byKey.size) return () => [];
  const alternatives = [...byKey.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
  const pattern = new RegExp(`(?<![\\w-])(?:${alternatives})(?![\\w-])`, "g");
  return (text) => [...text.matchAll(pattern)].map((match) => ({ name: byKey.get(match[0])!, start: match.index, end: match.index + match[0].length }));
}

/** Returns null when the search contains nothing the rules recognise, i.e. it is a plain text search. */
/**
 * Player terms for kinds of card, said in the words the reader understands. "Recruiter" is not a
 * tag of its own: it is a monster that Special Summons from the Deck when destroyed by battle.
 */
const PLAYER_TERMS: [RegExp, string][] = [
  [/\brecruiters?\b/g, "when destroyed by battle special summon a monster from the deck"],
  [/\bfloaters?\b/g, "when this card is destroyed special summon a monster"],
  [/\btutors?\b/g, "searchers"],
  // "self mill", "self-banish": doing it to your own cards.
  [/\bself[- ]?(mill\w*|banish\w*|destr\w*|discard\w*|tribut\w*|bounc\w*|send\w*|dump\w*)\b/g, "$1 your own"],
];

/** How the cards that support a kind of card name it in their text. */
const SUBTYPE_TERMS: Record<Subtype, string> = {
  normal: "Normal Monster",
  effect: "Effect Monster",
  tuner: "Tuner",
  xyz: "Xyz",
  synchro: "Synchro",
  fusion: "Fusion",
  link: "Link",
  ritual: "Ritual",
  pendulum: "Pendulum",
  token: "Token",
  flip: "FLIP",
  union: "Union",
  spirit: "Spirit",
  gemini: "Gemini",
  toon: "Toon",
  field: "Field Spell",
  quick_play: "Quick-Play Spell",
  equip: "Equip",
  counter: "Counter Trap",
  continuous: "Continuous",
};
const GENERIC = /\bgeneric\b/;

export function interpret(
  input: string,
  findArchetypes: ReturnType<typeof buildArchetypeMatcher> = () => [],
): Interpretation | null {
  let text = input
    .toLowerCase()
    .replace(/[“”"]/g, " ")
    .replace(/\bgrave ?yards?\b|\bgraves?\b/g, "gy")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  for (const [term, meaning] of PLAYER_TERMS) text = text.replace(term, meaning);

  const marks: Mark[] = [];
  const free = (start: number, end: number) => marks.every((mark) => end <= mark.start || start >= mark.end);
  /** Marks every non-overlapping match of a pattern. Earlier rules win, so order encodes priority. */
  const scan = (pattern: RegExp, make: (match: RegExpMatchArray) => Omit<Mark, "start" | "end">) => {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    for (const match of text.matchAll(global)) {
      const start = match.index;
      const end = start + match[0].length;
      if (end > start && free(start, end)) marks.push({ ...make(match), start, end });
    }
  };

  for (const [pattern, role] of ROLE_RULES) scan(pattern, () => ({ type: "role", role }));
  scan(WORKS_FROM, (match) => ({ type: "where", zone: toZone(match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[1]!.split(" ")[0]!) }));
  scan(QUICK, () => ({ type: "quick" }));
  for (const { start, end, stats } of statsInSearch(text)) if (free(start, end)) marks.push({ type: "stat", stats, start, end });
  scan(GENERIC, () => ({ type: "generic" }));
  for (const [pattern, deck] of DECK_RULES) scan(pattern, () => ({ type: "deck", deck }));
  scan(FROM_ZONE, (match) => ({
    type: "from",
    zone: toZone(match[3]!),
    opponent: [match[1], match[2]].some((owner) => owner && OPPONENT.test(owner)),
  }));
  scan(BANISHED_NOUN, () => ({ type: "from", zone: "banished" }));
  for (const rule of VERB_RULES) scan(rule.pattern, () => ({ type: "verb", rule }));
  scan(TO_ZONE, (match) => ({ type: "to", zone: toZone(match[1]!) }));
  for (const { name, start, end } of findArchetypes(text)) {
    if (free(start, end)) marks.push({ type: "archetype", archetype: name, start, end });
  }
  scan(SUPPORT, () => ({ type: "support" }));
  scan(CUE, () => ({ type: "cue" }));
  scan(SELF, () => ({ type: "self" }));
  for (const [pattern, level] of LEVEL_RULES) scan(pattern, (match) => ({ type: "level", level: level(Number(match[1])) }));
  for (const [pattern, subtype, kind] of SUBTYPE_RULES) scan(pattern, () => ({ type: "subtype", subtype, kinds: kind ? [kind] : [] }));
  for (const [pattern, kinds] of KIND_RULES) scan(pattern, () => ({ type: "kind", kinds }));
  for (const [pattern, monsterType] of TYPE_RULES) scan(pattern, () => ({ type: "type", monsterType }));
  for (const [pattern, attribute] of ATTRIBUTE_RULES) scan(pattern, () => ({ type: "attribute", attribute }));
  scan(OPPONENT, () => ({ type: "opponent" }));
  scan(YOURS, () => ({ type: "yours" }));
  scan(BOUNDARY, () => ({ type: "boundary" }));
  marks.sort((a, b) => a.start - b.start);

  // "is banished", "gets destroyed": a verb right after an auxiliary is something that happens to a card.
  const passive = (mark: Mark) => AUXILIARY.test(text.slice(Math.max(0, mark.start - 7), mark.start));

  const query: EffectQuery = { card: emptyObject(), roles: [], quick: false, text: "" };
  /** Kinds the card picked up only because a subtype implies them ("Normal Monster" → monster). */
  const impliedKinds: CardKind[] = [];
  const newEvent = (): EventQuery & { to?: Zone; rule?: VerbRule } => ({ verbs: [], from: [], self: false, object: emptyObject() });
  let does: ReturnType<typeof newEvent> | undefined;
  let reactsTo: ReturnType<typeof newEvent> | undefined;
  let supporting = false;
  /** Where descriptors currently land: the card itself until a verb or cue redirects them. */
  let target: "card" | "does" | "reactsTo" = "card";
  let awaitingTrigger = false;
  /** "Your opponent" or "you" named before any verb, waiting for the verb it is the subject of. */
  let subject: Mark | undefined;
  const unused: Mark[] = [];

  const targetObject = () => (target === "does" ? does!.object : target === "reactsTo" ? reactsTo!.object : query.card);
  const targetEvent = () => (target === "does" ? does : target === "reactsTo" ? reactsTo : undefined);

  for (const mark of marks) {
    switch (mark.type) {
      case "role":
        query.roles.push(mark.role!);
        break;
      case "quick":
        query.quick = true;
        break;
      case "where":
        query.worksFrom = mark.zone;
        break;
      case "generic":
        query.generic = true;
        break;
      case "deck": {
        const object = targetObject();
        object.deck = mark.deck;
        if (mark.deck === "extra" && !object.kinds.includes("monster")) object.kinds.push("monster");
        break;
      }
      case "support":
        supporting = true;
        break;
      case "cue":
        if (!reactsTo?.verbs.length) {
          reactsTo ??= newEvent();
          awaitingTrigger = true;
          target = "reactsTo";
        }
        break;
      case "boundary":
        awaitingTrigger = false;
        if (target === "reactsTo" && reactsTo?.verbs.length) target = does ? "does" : "card";
        break;
      case "verb": {
        const rule = mark.rule!;
        const asTrigger = rule.alwaysTrigger || awaitingTrigger || (passive(mark) && !reactsTo?.verbs.length);
        if (asTrigger && !reactsTo?.verbs.length) {
          reactsTo ??= newEvent();
          Object.assign(reactsTo, { verbs: rule.verbs, rule });
          awaitingTrigger = false;
          target = "reactsTo";
        } else if (!rule.triggerOnly && !does) {
          does = Object.assign(newEvent(), { verbs: rule.verbs, rule });
          target = "does";
        } else {
          unused.push(mark);
          break;
        }
        if (subject) {
          targetEvent()!.player ??= subject.type === "opponent" ? "opponent" : "you";
          unused.splice(unused.indexOf(subject), 1);
          subject = undefined;
        }
        break;
      }
      case "from": {
        const event = targetEvent();
        if (!event || !mark.zone) unused.push(mark);
        else {
          event.from.push(mark.zone);
          if (mark.opponent) event.player = "opponent";
        }
        break;
      }
      case "to": {
        const event = targetEvent();
        if (event) event.to = mark.zone;
        else unused.push(mark);
        break;
      }
      case "opponent":
      case "yours": {
        const event = targetEvent();
        if (event) event.player = mark.type === "opponent" ? "opponent" : "you";
        else {
          // Said before any verb, it is who acts: "your opponent adds a card to their hand".
          unused.push(mark);
          subject = mark;
        }
        break;
      }
      case "self": {
        const event = targetEvent();
        if (event) event.self = true;
        break;
      }
      case "level":
        Object.assign(targetObject(), mark.level);
        break;
      case "stat": {
        const object = targetObject();
        object.stats = mergeStats(object.stats ?? {}, mark.stats!);
        break;
      }
      case "kind":
        targetObject().kinds.push(...mark.kinds!);
        break;
      case "subtype":
        targetObject().subtypes.push(mark.subtype!);
        targetObject().kinds.push(...mark.kinds!);
        if (target === "card") impliedKinds.push(...mark.kinds!);
        break;
      case "type":
        targetObject().types.push(mark.monsterType!);
        break;
      case "attribute":
        targetObject().attributes.push(mark.attribute!);
        break;
      case "archetype":
        targetObject().archetypes.push(mark.archetype!);
        break;
    }
  }

  for (const event of [does, reactsTo]) {
    if (!event?.rule) continue;
    const { rule } = event;
    if (rule.generic === "return") event.verbs = event.to === "hand" ? ["return_to_hand"] : event.to === "deck" || event.to === "extra_deck" ? ["return_to_deck"] : rule.verbs;
    if (rule.generic === "send") event.verbs = event.to === "hand" ? ["return_to_hand"] : event.to === "deck" ? ["return_to_deck"] : ["send_to_gy"];
    if (rule.generic === "summon" && event === reactsTo) event.verbs = ["normal_summon", "special_summon"];
    if (rule.from && !event.from.length) event.from = [rule.from];
    // "Special Summon tokens" is its own event in the tags.
    if (event.object.subtypes.includes("token") && event.verbs.includes("special_summon")) {
      event.verbs = ["summon_token"];
      event.object.subtypes = event.object.subtypes.filter((subtype) => subtype !== "token");
    }
  }
  if (!does && query.card.subtypes.includes("token")) {
    does = Object.assign(newEvent(), { verbs: ["summon_token"] as Verb[] });
    query.card.subtypes = query.card.subtypes.filter((subtype) => subtype !== "token");
  }
  // A trigger with no subject is about the card itself: "triggers when banished".
  if (reactsTo?.verbs.length && isEmptyObject(reactsTo.object) && !reactsTo.player) reactsTo.self = true;
  if (reactsTo && !reactsTo.verbs.length) reactsTo = undefined;

  // What the card works with: an archetype named for the card, or anything named next to "support".
  const supports = emptyObject();
  supports.archetypes = query.card.archetypes;
  query.card.archetypes = [];
  if (supporting) {
    supports.types = query.card.types;
    supports.attributes = query.card.attributes;
    query.card.types = [];
    query.card.attributes = [];
    // "Normal Monster support" is cards that name Normal Monsters, not Normal Monsters themselves.
    if (query.card.subtypes.length) {
      query.mentions = query.card.subtypes.map((subtype) => SUBTYPE_TERMS[subtype]);
      query.card.subtypes = [];
      for (const kind of impliedKinds) query.card.kinds.splice(query.card.kinds.indexOf(kind), 1);
    }
  }
  if (!isEmptyObject(supports)) query.supports = supports;

  const strip = ({ verbs, from, player, self, object }: EventQuery): EventQuery => ({
    verbs,
    from: [...new Set(from)],
    player,
    self,
    object,
    ...(query.generic ? { generic: true } : {}),
  });
  if (does) query.does = strip(does);
  if (reactsTo) query.reactsTo = strip(reactsTo);

  const understood =
    query.does || query.reactsTo || query.supports || query.roles.length || query.quick || query.worksFrom || query.mentions || !isEmptyObject(query.card);
  if (!understood) return null;

  // Whatever no rule claimed still narrows the search, as ordinary text.
  const used = marks.filter((mark) => !unused.includes(mark));
  let rest = "";
  let cursor = 0;
  for (const mark of used) {
    rest += text.slice(cursor, mark.start) + " ";
    cursor = Math.max(cursor, mark.end);
  }
  rest += text.slice(cursor);
  // A zone already understood ("mill your own deck") says nothing more as a word to find.
  const zonesRead = new Set([...(query.does?.from ?? []), ...(query.reactsTo?.from ?? []), ...(query.worksFrom ? [query.worksFrom] : [])]);
  query.text = rest
    .split(/[^a-z0-9'@.-]+/)
    .filter((word) => word && !FILLER.has(word) && !(zonesRead.has(toZone(word)!) && toZone(word)))
    .join(" ");

  return { query, chips: describe(query) };
}

// --- Describing a reading ---------------------------------------------------------------------

const VERB_LABELS: Partial<Record<Verb, string>> = {
  add_to_hand: "add to hand",
  send_to_gy: "send to GY",
  return_to_hand: "return to hand",
  return_to_deck: "return to Deck",
  negate_activation: "negate",
  negate_effect: "negate",
  summon_token: "Summon Tokens",
  change_atk_def: "change ATK/DEF",
  take_control: "take control",
  inflict_damage: "inflict damage",
  gain_lp: "gain LP",
  pay_lp: "pay LP",
  prevent_destruction: "cannot be destroyed",
  prevent_targeting: "cannot be targeted",
  restrict_summon: "restrict Summons",
  restrict_activation: "restrict activations",
  restrict_attack: "restrict attacks",
  leave_field: "leave the field",
  used_as_material: "used as material",
  reveal_or_look: "reveal or look",
  set_spell_trap: "Set a Spell/Trap",
  attack_again: "attack again",
  attack_directly: "attack directly",
  destroy_by_battle: "destroy by battle",
};
const ZONE_LABELS: Record<Zone, string> = {
  hand: "hand",
  deck: "Deck",
  extra_deck: "Extra Deck",
  field: "field",
  pendulum_zone: "Pendulum Zone",
  gy: "GY",
  banished: "banished",
  attached: "Xyz materials",
};

const verbLabel = (verb: Verb) => VERB_LABELS[verb] ?? verb.replaceAll("_", " ").replace(/\b(summon|special|normal|fusion|ritual|synchro|xyz|link|pendulum)\b/g, (word) => word[0]!.toUpperCase() + word.slice(1));

function describeObject(object: ObjectQuery): string {
  const level =
    object.levelMin !== undefined && object.levelMin === object.levelMax
      ? `Level ${object.levelMin}`
      : object.levelMax !== undefined
        ? `Level ${object.levelMax} or lower`
        : object.levelMin !== undefined
          ? `Level ${object.levelMin} or higher`
          : "";
  const kinds = [...new Set(object.kinds)].map((kind) => kind[0]!.toUpperCase() + kind.slice(1)).join("/");
  const stats = object.stats ? describeStats(object.stats) : "";
  const deck = object.deck === "extra" ? "Extra Deck" : object.deck === "main" ? "Main Deck" : "";
  return [deck, level, ...object.attributes, ...object.types, ...object.archetypes.map((name) => `"${name}"`), ...object.subtypes.map((subtype) => subtype.replace("_", "-")), kinds, stats]
    .filter(Boolean)
    .join(" ");
}

function describeEvent(event: EventQuery): string {
  const verbs = [...new Set(event.verbs.map(verbLabel))].join(" or ");
  const what = event.self ? "itself" : describeObject(event.object);
  const owner = event.player === "opponent" ? "opponent's" : event.player === "you" ? "your" : "";
  const from = event.from.length ? `from ${owner ? owner + " " : ""}${event.from.map((zone) => ZONE_LABELS[zone]).join("/")}` : owner && `${owner} cards`;
  return [verbs, what, from].filter(Boolean).join(" · ");
}

function describe(query: EffectQuery): string[] {
  const chips: string[] = [];
  if (!isEmptyObject(query.card)) chips.push(`Card is: ${describeObject(query.card)}`);
  for (const role of query.roles) chips.push(`Role: ${role.replaceAll("_", " ")}`);
  if (query.quick) chips.push("Usable on the opponent's turn");
  if (query.worksFrom) chips.push(`Effect used from: ${ZONE_LABELS[query.worksFrom]}`);
  if (query.mentions) chips.push(`Supports: ${query.mentions.join(", ")}`);
  if (query.generic) chips.push("Generic: not tied to an archetype");
  if (query.does) chips.push(`Does: ${describeEvent(query.does)}`);
  if (query.reactsTo) chips.push(`Reacts to: ${describeEvent(query.reactsTo)}`);
  if (query.supports) chips.push(`Works with: ${describeObject(query.supports)}`);
  if (query.text) chips.push(`Text: ${query.text}`);
  return chips;
}
