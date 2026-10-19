/** The TCG sets cards were printed in, from YGOPRODeck: data/sets.json, written by scripts/prepare-cards.ts. */

export interface SetEntry {
  name: string;
  /** The set's code, as in the card numbers: "RA04" for RA04-EN001. */
  code: string;
  /** When it came out in the TCG (YYYY-MM-DD), when known. */
  date?: string;
  /** How many cards in the database it has. */
  cards: number;
}

export interface SetsFile {
  sets: SetEntry[];
  /** Card passcode -> positions in `sets`. */
  cards: Record<number, number[]>;
}

/** The sets a search's set filter means: an exact code ("RA04") or name, else any set whose name contains it. */
export function setsMatching(sets: readonly SetEntry[], asked: string): Set<number> {
  const wanted = asked.trim().toLowerCase();
  const exact = sets.flatMap((set, index) => (set.code.toLowerCase() === wanted || set.name.toLowerCase() === wanted ? [index] : []));
  if (exact.length) return new Set(exact);
  return new Set(sets.flatMap((set, index) => (set.name.toLowerCase().includes(wanted) ? [index] : [])));
}
