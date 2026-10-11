import type { Card } from "./card.ts";
import type { SynergyReading } from "./search.ts";
import type { CardTags } from "./tags.ts";

/** The shape of GET /api/search. */
export interface SearchResponse {
  total: number;
  page: number;
  pageSize: number;
  cardCount: number;
  taggedCount: number;
  /** How the search was read as an effect query; absent for plain text searches. */
  reading?: {
    chips: string[];
    /** False when no card fit the reading and the results are text matches instead. */
    matched: boolean;
  };
  /** How each exclusion was read, so the page can show what is being left out. */
  excluded?: { text: string; chips: string[] }[];
  /** Set for a synergy search: the deck asked about and the kinds of card looked for. */
  synergy?: SynergyReading;
  results: {
    card: Card;
    summary?: string;
    roles: CardTags["roles"];
    /** In a synergy search: why this card fits. */
    fits?: string[];
  }[];
}
