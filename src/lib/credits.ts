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
];
