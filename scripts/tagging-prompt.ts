/** Builds the system prompt and per-request card rendering for the tagging job. */
import * as z from "zod";
import type { Card } from "../src/lib/card.ts";
import { ALWAYS_PRESENT, CardTags, dropDefaults, LIMITS, ROLES, TIMINGS, VERBS, ZONES } from "../src/lib/tags.ts";
import { cleanTags } from "./tag-cleanup.ts";
import { TAGGING_EXAMPLES } from "./tagging-examples.ts";

/** What the model returns for one request: tags for every card it was given, keyed by card id. */
export const TagEntry = z.object({ id: z.int(), ...CardTags.shape });
export const TagBatch = z.object({ cards: z.array(TagEntry) });
export type TagBatch = z.infer<typeof TagBatch>;

/**
 * The structured-output format for a request. Built from Zod's own JSON Schema export rather than
 * the SDK's zodOutputFormat helper, which moves `enum` lists into descriptions: here the API must
 * enforce the vocabulary, or one out-of-vocabulary verb would fail validation for a whole request.
 */
export function tagBatchFormat(): { type: "json_schema"; schema: Record<string, unknown> } {
  return { type: "json_schema", schema: jsonSchema() };
}

/** The tag schema as JSON Schema, without the keywords the structured-output API rejects. */
function jsonSchema({ sparse = false } = {}): Record<string, unknown> {
  const unsupported = new Set(["$schema", "minimum", "maximum"]);
  const always = new Set<string>(["cards", ...ALWAYS_PRESENT]);
  return JSON.parse(
    JSON.stringify(z.toJSONSchema(TagBatch, { reused: "ref" }), (key, value) => {
      if (unsupported.has(key) && typeof value !== "object") return undefined;
      // In the sparse form only the fields without an empty value stay mandatory.
      if (sparse && key === "required" && Array.isArray(value)) return value.filter((name) => always.has(name));
      return value;
    }),
  ) as Record<string, unknown>;
}

const stat = (value: number | null | undefined) => (value == null ? "?" : String(value));

export function renderCard(card: Card): string {
  const lines = [`<card id="${card.id}">`, `Name: ${card.name}`];

  if (card.kind === "monster") {
    const stats = [
      card.monsterType,
      card.attribute,
      card.level != null && `Level ${card.level}`,
      card.rank != null && `Rank ${card.rank}`,
      card.linkRating != null && `Link ${card.linkRating}`,
      card.scale != null && `Pendulum Scale ${card.scale}`,
      `ATK ${stat(card.atk)}`,
      card.def !== undefined && `DEF ${stat(card.def)}`,
    ].filter(Boolean);
    lines.push(`Type: ${card.typeLine} (${stats.join(" / ")})`);
  } else {
    lines.push(`Type: ${card.typeLine}`);
  }

  if (card.archetype) lines.push(`Archetype: ${card.archetype}`);
  if (card.pendulumText) lines.push("Pendulum Effect:", card.pendulumText);
  lines.push(card.pendulumText ? "Monster text:" : "Text:", card.text, "</card>");
  return lines.join("\n");
}

const glossary = (entries: Record<string, string>) =>
  Object.entries(entries)
    .map(([key, description]) => `- ${key}: ${description}`)
    .join("\n");

/**
 * `sparse` is for providers whose API can only promise valid JSON rather than enforce the schema.
 * It spells the output format out in the prompt and has the model leave empty fields out, which
 * cuts the output (the expensive part) by about a third.
 */
export function buildSystemPrompt(cards: Card[], { sparse = false } = {}): string {
  const byName = new Map(cards.map((card) => [card.name, card]));
  const examples = TAGGING_EXAMPLES.map(({ name, tags }) => {
    const card = byName.get(name);
    if (!card) throw new Error(`Tagging example "${name}" is not in the card data`);
    const entry = { id: card.id, ...cleanTags(card, tags) };
    return `${renderCard(card)}\n${JSON.stringify(sparse ? dropDefaults(entry) : entry)}`;
  });

  return `You are indexing Yu-Gi-Oh! cards for an effect search engine. Players will use it to find cards that do a specific thing ("Special Summon a WATER monster from the GY") and cards that work with a specific thing ("anything that triggers when it is banished"). For each card you are given, describe what it does in the structured format below.

The search engine matches on your structured fields, so consistency matters more than nuance: two cards that do the same thing must be tagged the same way. The structured fields must reflect only what the card text says. Your knowledge of how the game is played belongs in summary, roles and keywords.

# How to break a card down

Split the text into effects: one entry per distinct effect or Summoning procedure, in the order they appear. Card text follows the pattern "condition: cost; resolution". The condition becomes triggers (events) and conditions (states), everything before the semicolon becomes costs, and what happens after it becomes actions. "You can banish 1 Link Monster from your GY; destroy 1 card" has a banish cost and a destroy action. With no semicolon there is no cost: in "You can Tribute as many monsters as possible, and if you do, Special Summon this card", both are actions.

- Triggers, costs and actions are all events: a verb, whose cards it involves, where those cards are beforehand, and which cards qualify.
- "X, and if you do, Y", "X, then Y" and "X, also Y" are several actions in one effect. "Activate 1 of these effects" and bulleted choices are also several actions in one effect; mark them "option 1", "option 2" in note.
- player is relative to the card's controller and says whose cards or Life Points the event happens to: "you" for yours, "opponent" for theirs, "either" when the text allows both or does not say. It is about where the affected cards are, not who benefits: "Target 1 monster in either GY; Special Summon it" is "either", "inflict 500 damage to your opponent" is "opponent", and "if a card you control is destroyed by an opponent's card effect" is "you" with the cause in note.
- what describes the cards the event happens to. Set this_card when it is this card itself ("If this card is sent to the GY", "Special Summon this card"). Put Types, Attributes, archetypes, named cards and Level ranges in their fields, and only what has no field ("1500 or less ATK", "Rank 4", "face-up", "non-Tuner") in other: "1 'Scrap Factory' or 1 non-Tuner 'Scrap' monster" is names ["Scrap Factory"], archetypes ["Scrap"], other "non-Tuner". Leave a field empty when the text does not restrict it: "1 monster" is kinds ["monster"] and nothing else, "1 card" is all fields empty.
- Archetype names go in archetypes exactly as quoted, without the quotes ("HERO", not "Elemental HERO" unless that is what the text says). A quoted name that is a single specific card goes in names.
- from is where the affected cards are before the event. Use ["deck"] for "from your Deck", ["hand", "gy"] for "from your hand or GY", and leave it empty when the text does not say.
- note is for a detail the other fields cannot hold and that changes which cards or situations qualify. Never use it to restate the action or the card text. Quantities and durations are only worth a note when they are unusual ("top 5 cards", "all monsters", "until the end of the next turn").
- location is where this card is when the effect is used. Activating a Spell or Trap Card is ["field"]. Use ["hand"] only for effects that are used while the card is in the hand, such as hand traps and Special Summoning itself from the hand. Pendulum Effects are ["pendulum_zone"]. "If you control no cards, you can activate this card from your hand" adds "hand" to the location of the card's activation and the requirement to its conditions; it is not an entry of its own.
- A phase is a trigger only when the effect happens at that point ("During the End Phase:", "At the start of the Battle Phase:"). A window in which a Quick or Ignition Effect may be used ("During your opponent's Main Phase (Quick Effect)", "if your opponent Summoned 5 or more monsters this turn") is a condition.
- A Summoning procedure ("You can Special Summon this card (from your hand) by...") and rules such as "Cannot be Normal Summoned/Set" or "Must first be Fusion Summoned" are entries with timing "condition".
- A restriction a card places on its own controller ("you cannot Special Summon for the rest of this turn, except DARK monsters") is an action with a restrict_ verb and player "you".
- For Extra Deck monsters, the material line goes in materials, one entry per requirement, and does not get an effect entry. "2+ Effect Monsters" is one entry with subtypes ["effect"]; "1 Tuner + 1+ non-Tuner monsters" is two entries.
- supports collects everything the card works with: the archetypes, specific cards, Types, Attributes and card types its text names as something it needs or benefits, across all effects and materials. A card also works with its own archetype, because other cards search and reuse it by name: always include the archetype from its Archetype line, so "Swordsoul Punishment" supports "Swordsoul" even though its text never says so. Leave out the card's own name, and its own Type and Attribute unless the text refers to them.
- "You can only activate 1 [this card] per turn" and "You can only use this effect of [this card] once per turn" set limit to hard_once_per_turn on the effect they restrict, and "each effect" sets it on every effect. They never get an entry of their own. A plain "Once per turn" belongs only to the effect it is written on.
- targets is true only when the text says "target".
- Normal Pendulum Monsters: tag the Pendulum Effect and ignore the flavor text.
- Older cards are worded loosely. Tag what the text means under current rules.

# Vocabulary

Zones:
${glossary(ZONES)}

Verbs:
${glossary(VERBS)}

Effect timing:
${glossary(TIMINGS)}

Effect limit:
${glossary(LIMITS)}

Roles (only the ones that are a main reason players run the card: often one to three, sometimes none):
${glossary(ROLES)}

# Summary and keywords

summary is one or two plain sentences a player would recognize, saying what the card does and when. keywords are up to six extra search terms that are not already in the summary: slang ("pop", "bounce", "spin", "mill", "tutor", "floodgate"), what the card is commonly used for, or a famous card with the same effect ("foolish burial", "monster reborn"). Skip keywords rather than pad them.

# Examples

Each example is a card followed by its entry in the output.

${examples.join("\n\n")}

# Output

Return one entry per card, in the order given, each carrying the id from its <card> tag.${sparse ? sparseOutputInstructions() : ""}`;
}

function sparseOutputInstructions(): string {
  return `

Respond with a single JSON object of the form {"cards": [...]} and nothing else. It must follow the JSON Schema below: use only the listed enum values spelled exactly as given, and add no fields of your own.

Leave out every field whose value would be empty: an empty list, "", 0, false, a limit of "none", or a what or supports with nothing in it. A missing field is read as empty, as in the examples above.

${JSON.stringify(jsonSchema({ sparse: true }))}`;
}

export function buildUserMessage(cards: Card[]): string {
  return cards.map(renderCard).join("\n\n");
}
