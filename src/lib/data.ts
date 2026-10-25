/** Server-only: loads the card data and tags from disk once and keeps the search index in memory. */
import fs from "node:fs/promises";
import path from "node:path";
import type { Card } from "./card.ts";
import { SearchIndex } from "./search.ts";
import type { CounterProfile, CounteredArchetype } from "./counters.ts";
import { FEATURES } from "./features.ts";
import { NO_OVERRIDES, type Overrides } from "./reports.ts";
import type { SetsFile } from "./sets.ts";
import type { ArchetypeProfile, ProfiledArchetype } from "./synergy.ts";
import type { CardTags, TaggedCard } from "./tags.ts";

const DATA_DIR = path.join(process.cwd(), "data");

async function load(): Promise<SearchIndex> {
  const cards = JSON.parse(await fs.readFile(path.join(DATA_DIR, "cards.json"), "utf8")) as Card[];

  const tagsById = new Map<number, CardTags>();
  // The tags file does not exist until the tagging job has run; search works without it.
  const tagLines = await fs.readFile(path.join(DATA_DIR, "tags/tags.jsonl"), "utf8").catch(() => "");
  for (const line of tagLines.split("\n")) {
    if (!line) continue;
    const row = JSON.parse(line) as TaggedCard;
    tagsById.set(row.id, row.tags);
  }

  const profiles = new Map<string, ArchetypeProfile>();
  // Likewise the synergy profiles: without them a synergy search is read as an ordinary one.
  const profileLines = await fs.readFile(path.join(DATA_DIR, "synergy/profiles.jsonl"), "utf8").catch(() => "");
  for (const line of profileLines.split("\n")) {
    if (!line) continue;
    const row = JSON.parse(line) as ProfiledArchetype;
    profiles.set(row.archetype, row.profile);
  }

  const counters = new Map<string, CounterProfile>();
  // Counter searches are switched on per machine, so they can be tried locally before the live site
  // gets them: SEARCHYGO_COUNTERS=1 in .env.local here, and in Vercel's settings when it is time.
  if (process.env.SEARCHYGO_COUNTERS === "1") {
    const counterLines = await fs.readFile(path.join(DATA_DIR, "counters/profiles.jsonl"), "utf8").catch(() => "");
    for (const line of counterLines.split("\n")) {
      if (!line) continue;
      const row = JSON.parse(line) as CounteredArchetype;
      counters.set(row.archetype, row.profile);
    }
  }

  // The sets cards were printed in; without the file the set filter simply finds nothing.
  const sets = JSON.parse(await fs.readFile(path.join(DATA_DIR, "sets.json"), "utf8").catch(() => '{"sets":[],"cards":{}}')) as SetsFile;

  // Fixes approved from people's reports; see src/lib/reports.ts.
  const overrides = JSON.parse(await fs.readFile(path.join(DATA_DIR, "overrides.json"), "utf8").catch(() => JSON.stringify(NO_OVERRIDES))) as Overrides;

  return new SearchIndex(cards, tagsById, profiles, counters, sets, FEATURES.related, overrides);
}

let index: Promise<SearchIndex> | undefined;

export function getSearchIndex(): Promise<SearchIndex> {
  index ??= load();
  return index;
}
