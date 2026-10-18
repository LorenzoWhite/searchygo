/** The orders search results can be put in, shared by the search (server) and the page (browser). */

/** Orders a search's results can be put in. "match" is the search's own ranking. */
export const SORTS = ["match", "name", "atk", "def", "level", "date", "popular"] as const;
export type SortBy = (typeof SORTS)[number];
export type SortDirection = "asc" | "desc";
/** Each order's natural direction: names A to Z, the biggest numbers and the newest cards first. */
export const SORT_DIRECTIONS: Record<SortBy, SortDirection> = {
  match: "desc",
  name: "asc",
  atk: "desc",
  def: "desc",
  level: "desc",
  date: "desc",
  popular: "desc",
};
