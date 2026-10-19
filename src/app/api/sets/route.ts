import { DATA_CACHE_CONTROL } from "@/lib/cache";
import { getSearchIndex } from "@/lib/data";

/** GET /api/sets lists the TCG sets, newest first, for suggesting names in the set filter. */
export async function GET() {
  const index = await getSearchIndex();
  const sets = [...index.sets.sets]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.name.localeCompare(b.name))
    .map(({ name, code, date }) => ({ name, code, date }));
  return Response.json({ sets }, { headers: { "Cache-Control": DATA_CACHE_CONTROL } });
}
