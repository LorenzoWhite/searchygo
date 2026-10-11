/**
 * Downloads the full card database from YGOPRODeck into data/raw/.
 * Their API guide asks consumers to fetch once and store locally, so run this only to pick up new sets.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { RAW_CARDS_PATH } from "./paths.ts";

// `format=genesys` still returns every card; it only adds each card's Genesys point value.
const URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes&format=genesys";

const res = await fetch(URL);
if (!res.ok) throw new Error(`YGOPRODeck responded ${res.status} ${res.statusText}`);
const body = await res.text();
const count = (JSON.parse(body) as { data: unknown[] }).data.length;

await fs.mkdir(path.dirname(RAW_CARDS_PATH), { recursive: true });
await fs.writeFile(RAW_CARDS_PATH, body);
console.log(`Saved ${count} cards (${(body.length / 1e6).toFixed(1)} MB) to ${RAW_CARDS_PATH}`);
