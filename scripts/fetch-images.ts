/**
 * Downloads a card image for every card from YGOPRODeck into public/cards/<size>/, so the site can
 * serve its own copies (their API guide asks for this rather than linking to their images).
 *
 *   pnpm cards:images              small card images, most-viewed cards first
 *   pnpm cards:images --limit 200  only the next 200 that are missing
 *
 * Images already on disk are skipped, so it can be stopped and re-run, and re-run after new sets.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Card } from "../src/lib/card.ts";
import { CARD_IMAGES_DIR, CARDS_PATH } from "./paths.ts";

const { values: args } = parseArgs({
  options: {
    size: { type: "string", default: "small" },
    limit: { type: "string" },
    concurrency: { type: "string", default: "6" },
  },
});

const SOURCES: Record<string, string> = {
  small: "https://images.ygoprodeck.com/images/cards_small",
  full: "https://images.ygoprodeck.com/images/cards",
  cropped: "https://images.ygoprodeck.com/images/cards_cropped",
};
const source = SOURCES[args.size];
if (!source) {
  console.error(`Unknown --size "${args.size}". Use one of: ${Object.keys(SOURCES).join(", ")}.`);
  process.exit(1);
}

/** Their API allows 20 requests a second; stay well under it. */
const MAX_PER_SECOND = 12;
const ATTEMPTS = 3;

const directory = path.join(CARD_IMAGES_DIR, args.size);
fs.mkdirSync(directory, { recursive: true });
const onDisk = new Set(fs.readdirSync(directory));

const cards = (JSON.parse(fs.readFileSync(CARDS_PATH, "utf8")) as Card[]).sort((a, b) => b.views - a.views);
const absent = cards.filter((card) => !onDisk.has(`${card.id}.jpg`));
const missing = args.limit ? absent.slice(0, Number(args.limit)) : absent;
console.log(`${cards.length - absent.length} of ${cards.length} images already in ${directory}; fetching ${missing.length}.`);

let lastStart = 0;
/** Spaces request starts evenly so the rate holds however many workers are running. */
async function takeTurn() {
  const start = Math.max(Date.now(), lastStart + 1000 / MAX_PER_SECOND);
  lastStart = start;
  await new Promise((resolve) => setTimeout(resolve, start - Date.now()));
}

const isJpeg = (bytes: Buffer) => bytes[0] === 0xff && bytes[1] === 0xd8;

async function fetchImage(card: Card): Promise<"saved" | "absent" | "failed"> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await takeTurn();
    try {
      const response = await fetch(`${source}/${card.id}.jpg`);
      if (response.status === 404) return "absent";
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (isJpeg(bytes)) {
          // Written under a temporary name first, so an interrupted run never leaves half an image behind.
          const file = path.join(directory, `${card.id}.jpg`);
          fs.writeFileSync(`${file}.part`, bytes);
          fs.renameSync(`${file}.part`, file);
          return "saved";
        }
      }
    } catch {
      // network hiccup: fall through to the retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  return "failed";
}

const counts = { saved: 0, absent: 0, failed: 0 };
const problems: string[] = [];
let next = 0;
let bytes = 0;
const worker = async () => {
  while (next < missing.length) {
    const card = missing[next++]!;
    const outcome = await fetchImage(card);
    counts[outcome]++;
    if (outcome === "saved") bytes += fs.statSync(path.join(directory, `${card.id}.jpg`)).size;
    else problems.push(`${card.name} (${card.id}): ${outcome === "absent" ? "no image on the server" : "download failed"}`);
    const done = counts.saved + counts.absent + counts.failed;
    if (done % 500 === 0) console.log(`  ${done}/${missing.length} (${(bytes / 1e6).toFixed(0)} MB)`);
  }
};
await Promise.all(Array.from({ length: Number(args.concurrency) }, worker));

console.log(`\nSaved ${counts.saved} images (${(bytes / 1e6).toFixed(0)} MB); ${counts.absent} not on the server, ${counts.failed} failed.`);
for (const problem of problems.slice(0, 20)) console.log(`  ${problem}`);
if (problems.length > 20) console.log(`  ...and ${problems.length - 20} more`);
if (counts.failed) console.log("Re-run to retry the failed ones.");
