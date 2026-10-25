import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getSearchIndex } from "@/lib/data";
import { FEATURES } from "@/lib/features";
import { REPORT_KINDS, saveReport, type ReportKind } from "@/lib/reports";

const MIN_NOTE = 15;
const MAX_NOTE = 500;
/** At most this many reports from one address in WINDOW_MS, counted per server instance. */
const MAX_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000;
const recent = new Map<string, number[]>();

const answer = (status: number, message: string) => Response.json({ ok: status < 300, message }, { status });

/**
 * POST /api/report takes {kind, search, deck?, card (passcode, for a mismatch) or cardName (for a
 * suggestion), note, website}. "website" is a field people never see; anything in it marks a bot.
 */
export async function POST(request: NextRequest) {
  if (!FEATURES.reports) return answer(404, "Reports are not open yet.");
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return answer(400, "That report could not be read.");
  // A bot fills in every field; say thanks and keep nothing.
  if (typeof body.website === "string" && body.website !== "") return answer(200, "Thanks, noted.");

  const kind = body.kind as ReportKind;
  if (!REPORT_KINDS.includes(kind)) return answer(400, "Unknown kind of report.");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length < MIN_NOTE) return answer(400, `Say how in a sentence or two (at least ${MIN_NOTE} characters).`);
  if (note.length > MAX_NOTE) return answer(400, `Keep it under ${MAX_NOTE} characters.`);

  const index = await getSearchIndex();
  const card =
    typeof body.card === "number"
      ? index.card(body.card)
      : typeof body.cardName === "string"
        ? index.cardNamed(body.cardName)
        : undefined;
  if (!card) return answer(400, kind === "suggestion" ? "No card has that name. Check the spelling." : "That card was not found.");

  // The address is only counted in memory, never kept with the report.
  const sender = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const times = (recent.get(sender) ?? []).filter((time) => now - time < WINDOW_MS);
  if (times.length >= MAX_PER_WINDOW) return answer(429, "That is a lot of reports at once. Try again in a few minutes.");
  recent.set(sender, [...times, now]);

  const saved = await saveReport({
    id: randomUUID(),
    kind,
    at: new Date(now).toISOString(),
    search: typeof body.search === "string" ? body.search.slice(0, 200) : "",
    deck: typeof body.deck === "string" && body.deck ? body.deck.slice(0, 80) : undefined,
    card: { id: card.id, name: card.name },
    note,
  }).catch(() => false);
  return saved ? answer(200, "Thanks, it will be looked at.") : answer(503, "Reports can't be received right now.");
}
