/** Runs a search from the terminal: pnpm cards:search "special summon from gy" */
import { getSearchIndex } from "../src/lib/data.ts";

const text = process.argv.slice(2).join(" ");
const index = await getSearchIndex();
const started = performance.now();
const { total, hits, reading, synergy } = index.search({ text, limit: 10 });
const elapsed = performance.now() - started;

console.log(`${total} results for "${text}" in ${elapsed.toFixed(1)} ms`);
if (reading) console.log(`read as: ${reading.chips.join(" | ")}${reading.matched ? "" : "  (no card fits; showing text matches)"}`);
if (synergy) {
  console.log(`\n${synergy.archetype}: ${synergy.plan}`);
  for (const hook of synergy.hooks) console.log(`  - ${hook.label} (${hook.matches} cards): ${hook.why}`);
}
console.log();
for (const { card, tags, score, fits } of hits) {
  console.log(`${score.toFixed(1).padStart(7)}  ${card.name}  [${card.typeLine}]${fits ? `  fits: ${fits.join("; ")}` : ""}`);
  console.log(`         ${(tags?.summary ?? card.text).replaceAll("\n", " ").slice(0, 150)}`);
}
