/**
 * Prints tagged cards in a compact form next to their card text, for judging tag quality by eye.
 *
 *   pnpm cards:review data/tags/sample-deepseek.jsonl
 *   pnpm cards:review data/tags/sample-deepseek.jsonl "Monster Reborn"
 */
import fs from "node:fs";
import type { Card } from "../src/lib/card.ts";
import type { CardFilter, GameEvent, TaggedCard } from "../src/lib/tags.ts";
import { CARDS_PATH, TAGS_PATH } from "./paths.ts";

const [file = TAGS_PATH, nameFilter] = process.argv.slice(2);

const cards = new Map((JSON.parse(fs.readFileSync(CARDS_PATH, "utf8")) as Card[]).map((card) => [card.id, card]));
const rows = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as TaggedCard)
  .filter((row) => row.model !== "hand-written")
  .filter((row) => !nameFilter || row.name.toLowerCase().includes(nameFilter.toLowerCase()));

function filter(what: CardFilter): string {
  const parts = [
    what.this_card && "THIS",
    ...what.kinds,
    ...what.subtypes,
    ...what.types,
    ...what.attributes,
    ...what.archetypes.map((name) => `"${name}"`),
    ...what.names.map((name) => `[${name}]`),
    (what.level_min || what.level_max) && `L${what.level_min || ""}-${what.level_max || ""}`,
    what.other && `{${what.other}}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "any";
}

function event({ verb, player, from, what, note }: GameEvent): string {
  return `${verb}(${player}${from.length ? ` from ${from.join("/")}` : ""}: ${filter(what)})${note ? ` — ${note}` : ""}`;
}

for (const { id, name, model, tags } of rows) {
  const card = cards.get(id);
  console.log(`\n=== ${name} — ${card?.typeLine ?? "unknown card"} [${model}]`);
  if (card?.pendulumText) console.log(`PEND: ${card.pendulumText.replaceAll("\n", " ")}`);
  console.log(`TEXT: ${card?.text.replaceAll("\n", " ")}`);
  console.log(`SUMMARY: ${tags.summary}`);
  console.log(`ROLES: ${tags.roles.join(", ") || "-"}   KEYWORDS: ${tags.keywords.join(", ") || "-"}`);
  for (const [index, effect] of tags.effects.entries()) {
    const flags = [effect.timing, `@${effect.location.join("/") || "?"}`, effect.limit !== "none" && effect.limit, effect.targets && "targets"];
    console.log(`  ${index + 1}. ${flags.filter(Boolean).join(" ")}`);
    for (const condition of effect.conditions) console.log(`       if   ${condition}`);
    for (const trigger of effect.triggers) console.log(`       when ${event(trigger)}`);
    for (const cost of effect.costs) console.log(`       cost ${event(cost)}`);
    for (const action of effect.actions) console.log(`       does ${event(action)}`);
  }
  if (tags.materials.length) console.log(`  MATERIALS: ${tags.materials.map(filter).join(" + ")}`);
  const supports = Object.entries(tags.supports).flatMap(([key, values]) => (values.length ? [`${key}: ${values.join(", ")}`] : []));
  if (supports.length) console.log(`  SUPPORTS: ${supports.join("; ")}`);
}
console.log(`\n${rows.length} cards from ${file}`);
