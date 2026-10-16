import type { NextRequest } from "next/server";
import { DATA_CACHE_CONTROL, RecentCache } from "@/lib/cache";
import { ATTRIBUTES, CARD_KINDS, FORMATS, MD_RARITIES, MONSTER_TYPES, SUBTYPES } from "@/lib/card";
import { getSearchIndex } from "@/lib/data";
import { ROLES } from "@/lib/tags";
import type { SearchQuery } from "@/lib/search";

const PAGE_SIZE = 30;
const MAX_QUERY_LENGTH = 200;
const MAX_EXCLUSIONS = 8;
const MAX_EXCLUSION_LENGTH = 100;

/**
 * Answers already worked out, as the text that was sent, kept for as long as this server process
 * lives. Popular searches and the steps of typing them repeat constantly, and the data behind them
 * does not change while the process is running.
 */
const answers = new RecentCache<string>(300);

/** Searching ignores case and spacing, so searches that differ only in those share one answer. */
const plain = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Reads a comma-separated parameter, keeping only values from the allowed list. */
function list<T extends string>(params: URLSearchParams, name: string, allowed: readonly T[]): T[] {
  const values = params.get(name)?.split(",") ?? [];
  return values.filter((value): value is T => (allowed as readonly string[]).includes(value));
}

function integer(params: URLSearchParams, name: string): number | undefined {
  const value = Number.parseInt(params.get(name) ?? "", 10);
  return Number.isNaN(value) ? undefined : value;
}

/** A range picked backwards ("2010 to 2005") means the years between them. */
function years(from?: number, to?: number): Pick<SearchQuery, "yearFrom" | "yearTo"> {
  return from != null && to != null && from > to ? { yearFrom: to, yearTo: from } : { yearFrom: from, yearTo: to };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const page = Math.max(1, integer(params, "page") ?? 1);

  const query: SearchQuery = {
    text: plain((params.get("q") ?? "").slice(0, MAX_QUERY_LENGTH)),
    literal: params.get("literal") === "1",
    kinds: list(params, "kind", CARD_KINDS),
    attributes: list(params, "attribute", ATTRIBUTES),
    monsterTypes: list(params, "type", MONSTER_TYPES),
    subtypes: list(params, "subtype", SUBTYPES),
    roles: list(params, "role", Object.keys(ROLES) as (keyof typeof ROLES)[]),
    levelMin: integer(params, "levelMin"),
    levelMax: integer(params, "levelMax"),
    format: list(params, "format", FORMATS)[0],
    ...years(integer(params, "from"), integer(params, "to")),
    mdRarities: list(params, "rarity", MD_RARITIES),
    genesysMin: integer(params, "genesysMin"),
    genesysMax: integer(params, "genesysMax"),
    exclude: (params.get("not") ?? "")
      .split("|")
      .map((entry) => plain(entry.slice(0, MAX_EXCLUSION_LENGTH)))
      .filter(Boolean)
      .slice(0, MAX_EXCLUSIONS),
    offset: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  };

  const key = JSON.stringify(query);
  let answer = answers.get(key);
  if (!answer) {
    const index = await getSearchIndex();
    const { total, hits, reading, synergy, counters, excluded } = index.search(query);
    answer = JSON.stringify({
      total,
      page,
      pageSize: PAGE_SIZE,
      cardCount: index.cardCount,
      taggedCount: index.taggedCount,
      reading,
      excluded,
      synergy,
      counters,
      results: hits.map(({ card, tags, fits, stops, answer }) => ({
        card,
        summary: tags?.summary,
        roles: tags?.roles ?? [],
        fits,
        stops,
        answer,
      })),
    });
    answers.set(key, answer);
  }
  return new Response(answer, { headers: { "Content-Type": "application/json", "Cache-Control": DATA_CACHE_CONTROL } });
}
