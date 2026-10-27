/**
 * The people who found bugs in Search YGO or suggested changes to it, shown on /credits. Names are
 * as they appear in the YouTube comments where the feedback was left. The feedback routine
 * (.claude/skills/ygosearchfeedback/SKILL.md) adds an entry whenever something someone raised is planned or done.
 */

export const CREDIT_STATUSES = ["added", "fixed", "coming", "planned"] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

export interface Credit {
  /** Who raised it, as their YouTube name. */
  by: string[];
  kind: "bug" | "idea";
  /** What it was, said plainly. */
  what: string;
  status: CreditStatus;
  /** When the entry was last changed (YYYY-MM-DD). */
  date: string;
}

/** Where the feedback came from, for the page's introduction. */
export const FEEDBACK_VIDEO = "https://www.youtube.com/watch?v=hihNZ2WPxIs";

export const CREDITS: Credit[] = [
  {
    by: ["@azzaelulbrinter"],
    kind: "idea",
    what: "Search by player terms like “recruiters” (Mother Grizzly, Mystic Tomato), “floaters” and “tutors”",
    status: "added",
    date: "2026-10-16",
  },
  {
    by: ["@azzaelulbrinter", "@fabri.tmp00"],
    kind: "idea",
    what: "Filter by format: TCG, OCG, Master Duel, Duel Links, Speed Duel, GOAT, Edison and more",
    status: "added",
    date: "2026-10-16",
  },
  {
    by: ["@azzaelulbrinter", "@3750gustavo"],
    kind: "idea",
    what: "Filter by the year a card came out, for older formats",
    status: "added",
    date: "2026-10-16",
  },
  {
    by: ["@OutOfCharacters", "@affanabito"],
    kind: "idea",
    what: "Search for effects used from the GY, the hand or while banished (“Spells with GY effects”)",
    status: "added",
    date: "2026-10-16",
  },
  {
    by: ["@pickaxepixie518"],
    kind: "idea",
    what: "Find cards that bring two decks together: “synergy with Vaalmonica and Sky Striker”",
    status: "added",
    date: "2026-10-18",
  },
  {
    by: ["@st0rmerc00l8"],
    kind: "idea",
    what: "“Generic” searches that leave out effects locked to one archetype: “generic search EARTH Machine”",
    status: "added",
    date: "2026-10-18",
  },
  {
    by: ["@OutOfCharacters", "@LittleMushroomGuy"],
    kind: "bug",
    what: "The GitHub link in the video description led to a 404",
    status: "fixed",
    date: "2026-10-16",
  },
  {
    by: ["@whyarewehere....justtosuffer"],
    kind: "bug",
    what: "“self mill” looked for the word “self” instead of milling your own Deck",
    status: "fixed",
    date: "2026-10-18",
  },
  {
    by: ["@Vuohenmor"],
    kind: "bug",
    what: "“Normal Monster support” found Normal Monsters rather than the cards that support them",
    status: "fixed",
    date: "2026-10-18",
  },
  {
    by: ["@joshuasison3301"],
    kind: "bug",
    what: "Droll & Lock Bird is Limited on the October 19 list",
    status: "fixed",
    date: "2026-10-19",
  },
  {
    by: ["@KilatVolk", "@3750gustavo"],
    kind: "idea",
    what: "Choose how results are sorted: by name, ATK/DEF, Level, release date or popularity",
    status: "added",
    date: "2026-10-18",
  },
  {
    by: ["@pokestar9994"],
    kind: "idea",
    what: "Search by stats: “2400 ATK 1000 DEF”, “0 DEF”, “ATK 2000 or more”, plus ATK and DEF filters",
    status: "added",
    date: "2026-10-19",
  },
  {
    by: ["@st0rmerc00l8"],
    kind: "idea",
    what: "Find cards that search or summon by stats: the Kuriboh searchers (300 ATK/200 DEF), Gizmek (ATK equal to DEF)",
    status: "added",
    date: "2026-10-19",
  },
  {
    by: ["@galaxystar6621"],
    kind: "idea",
    what: "Filter by the TCG set a card was printed in, by name or code",
    status: "added",
    date: "2026-10-19",
  },
  {
    by: ["@FoxyPercival714"],
    kind: "idea",
    what: "Card suggestions in the deck builder, based on what the deck already plays",
    status: "planned",
    date: "2026-10-19",
  },
  {
    by: ["@katiegrayx3637"],
    kind: "idea",
    what: "Cards with similar effects worded differently, from a card's related cards",
    status: "planned",
    date: "2026-10-19",
  },
  {
    by: ["@megaagentj2248"],
    kind: "bug",
    what: "Searchers locked to cards that mention a name (Wishes for Eyes of Blue) came up in every “search a Spell” search",
    status: "fixed",
    date: "2026-10-19",
  },
  {
    by: ["@Badbufon"],
    kind: "bug",
    what: "“your opponent adds a card to their hand” and “opponent gains LP” did not read who acts",
    status: "fixed",
    date: "2026-10-19",
  },
  {
    by: ["@shadow306k"],
    kind: "idea",
    what: "Filter to Main Deck or Extra Deck monsters, and “Extra Deck EARTH Warrior monsters” in searches",
    status: "added",
    date: "2026-10-19",
  },
  {
    by: ["@Badbufon"],
    kind: "idea",
    what: "See every legal target of a card: what Nightmell the Dark Bonder can summon, what Small World can use",
    status: "planned",
    date: "2026-10-20",
  },
  {
    by: ["@st0rmerc00l8"],
    kind: "idea",
    what: "Name a card and find the cards that can search or summon it",
    status: "planned",
    date: "2026-10-20",
  },
  {
    by: ["@massunoi"],
    kind: "bug",
    what: "“synergy with Ojama” listed cards that react to the opponent Summoning, which Ojama's tokens never trigger",
    status: "fixed",
    date: "2026-10-22",
  },
  {
    by: ["@Arasarcan"],
    kind: "bug",
    what: "“synergy with Enneacraft” listed cards like Zero Gravity as putting monsters face-down, which they cannot do",
    status: "fixed",
    date: "2026-10-22",
  },
  {
    by: ["@skyduskguy", "@NickMirambeau"],
    kind: "bug",
    what: "Effects locked to named cards showed up for things those cards can't be: Volcanic Scattershot in Skull Servant synergy, Radiant Typhoon Chant in “search level 4 warrior”",
    status: "fixed",
    date: "2026-10-22",
  },
  {
    by: ["@skyduskguy"],
    kind: "idea",
    what: "A way to report a wrong synergy or counter result, and to suggest a missing card",
    status: "coming",
    date: "2026-10-22",
  },
  {
    by: ["@jacobkleinheinz376"],
    kind: "idea",
    what: "Search for Trap monsters, the Traps that Special Summon themselves (Tiki Curse, Tiki Soul)",
    status: "added",
    date: "2026-10-26",
  },
  {
    by: ["@KobiSheero"],
    kind: "bug",
    what: "Searching “Ruin & Demise” did not find the archetype, which the card data files as “Demise”",
    status: "fixed",
    date: "2026-10-27",
  },
];
