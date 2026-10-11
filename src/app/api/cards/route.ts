import type { NextRequest } from "next/server";
import { DATA_CACHE_CONTROL } from "@/lib/cache";
import type { Card } from "@/lib/card";
import { getSearchIndex } from "@/lib/data";

/** More than any deck holds (60 + 15 + 15), with room for a file that breaks the limits. */
const MAX_IDS = 200;

/**
 * GET /api/cards?ids=1,2,3 looks cards up by passcode, for a deck that is being loaded or
 * imported. `cards` is keyed by the passcode that was asked for, so an alternate artwork's
 * passcode leads to its card; `unknown` lists the passcodes that match nothing.
 */
export async function GET(request: NextRequest) {
  const asked = (request.nextUrl.searchParams.get("ids") ?? "").split(",").map(Number);
  const ids = [...new Set(asked.filter((id) => Number.isInteger(id) && id > 0))].slice(0, MAX_IDS);

  const index = await getSearchIndex();
  const cards: Record<number, Card> = {};
  const unknown: number[] = [];
  for (const id of ids) {
    const card = index.card(id);
    if (card) cards[id] = card;
    else unknown.push(id);
  }
  return Response.json({ cards, unknown }, { headers: { "Cache-Control": DATA_CACHE_CONTROL } });
}
