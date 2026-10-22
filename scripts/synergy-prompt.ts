/** Builds the instructions and per-archetype message for the synergy job. */
import * as z from "zod";
import { ATTRIBUTES, CARD_KINDS, MONSTER_TYPES, SUBTYPES, type Card } from "../src/lib/card.ts";
import { ArchetypeProfile, MAX_HOOKS } from "../src/lib/synergy.ts";
import { VERBS, ZONES } from "../src/lib/vocabulary.ts";
import { renderCard } from "./tagging-prompt.ts";

/** A large archetype is shown by its best-known cards, which are the ones that define how it plays. */
export const MAX_CARDS_SHOWN = 40;

/**
 * Profiles written by hand. They show the model what a good hook looks like, and they stand as the
 * profiles of their own archetypes.
 */
export const SYNERGY_EXAMPLES: { archetype: string; profile: ArchetypeProfile }[] = [
  {
    archetype: "Dark World",
    profile: {
      plan: "Fiends that trigger when a card effect discards them, so the deck throws its own hand away on purpose and turns each discard into a search, a Special Summon or removal.",
      hooks: [
        {
          label: "Discards your own hand",
          why: "Grapha, Snoww, Sillva and the rest only work when a card effect discards them, so any outside card that makes you discard is an activator.",
          does: { verbs: ["discard"], from: ["hand"], player: "you", self: false, what: { kinds: ["monster"], subtypes: [], types: ["Fiend"], attributes: ["DARK"], level_min: 0, level_max: 0 } },
          reacts_to: null,
          card: null,
          supports: null,
          phrases: [],
        },
        {
          label: "Fiend support",
          why: "Every Dark World monster is a Fiend, so cards that search, revive or boost Fiends work on the whole deck.",
          does: null,
          reacts_to: null,
          card: null,
          supports: { types: ["Fiend"], attributes: [] },
          phrases: [],
        },
      ],
    },
  },
  {
    archetype: "Tearlaments",
    profile: {
      plan: "Sends its own cards from the Deck to the GY; Tearlaments monsters sent there by a card effect Fusion Summon by shuffling materials from the hand, field and GY back into the Deck.",
      hooks: [
        {
          label: "Mills your own Deck",
          why: "Scheiren, Havnis and Merrli Fusion Summon when a card effect sends them to the GY, so every outside card that mills is another way to start.",
          does: { verbs: ["send_to_gy", "excavate"], from: ["deck"], player: "you", self: false, what: { kinds: ["monster"], subtypes: [], types: ["Aqua"], attributes: ["DARK"], level_min: 0, level_max: 0 } },
          reacts_to: null,
          card: null,
          supports: null,
          phrases: [],
        },
        {
          label: "Wants to be sent to the GY",
          why: "The deck mills three to five cards at a time, so outside monsters with an effect when they are sent to the GY get used for free.",
          does: null,
          reacts_to: { verbs: ["send_to_gy"], from: [], player: "you", self: true, what: { kinds: [], subtypes: [], types: [], attributes: [], level_min: 0, level_max: 0 } },
          card: { kinds: ["monster"], subtypes: [], types: [], attributes: [], level_min: 0, level_max: 0 },
          supports: null,
          phrases: [],
        },
        {
          label: "Aqua support",
          why: "The Main Deck Tearlaments monsters are all Aqua, and their Fusions ask for Aqua materials.",
          does: null,
          reacts_to: null,
          card: null,
          supports: { types: ["Aqua"], attributes: [] },
          phrases: [],
        },
      ],
    },
  },
];

/** The profile schema as JSON Schema, without the keywords the structured-output API rejects. */
export function profileFormat(): { type: "json_schema"; schema: Record<string, unknown> } {
  const unsupported = new Set(["$schema", "minimum", "maximum"]);
  const schema = JSON.parse(
    JSON.stringify(z.toJSONSchema(ArchetypeProfile, { reused: "ref" }), (key, value) => (unsupported.has(key) && typeof value !== "object" ? undefined : value)),
  ) as Record<string, unknown>;
  return { type: "json_schema", schema };
}

const glossary = (terms: Record<string, string>) =>
  Object.entries(terms)
    .map(([term, meaning]) => `- ${term}: ${meaning}`)
    .join("\n");

export function buildSynergyPrompt(): string {
  return `You are helping build a search engine for Yu-Gi-Oh! cards. Every card in its database has been described in a fixed vocabulary: what each of its effects does, costs and reacts to. Players want to ask it "what works with this archetype?" and get cards from OUTSIDE the archetype that fit it, including ones they would not have thought of.

You will be given one archetype and its cards. Work out which kinds of outside card are good partners for it, and describe each kind so the engine can pick those cards out of the database. Reply with a JSON object:

{
  "plan": "One sentence a player would recognise: what the deck does.",
  "hooks": [ 2 to ${MAX_HOOKS} hooks ]
}

A hook describes ONE kind of outside card:

{
  "label": "Two to five words naming the kind of card, as a player would say it",
  "why": "One sentence: what in THIS archetype makes that kind of card good with it. Name the card or effect.",
  "does": an event the outside card causes, as an effect or as a cost; or null,
  "reacts_to": an event the outside card responds to; or null,
  "card": what the outside card itself must be; or null,
  "supports": {"types": [...], "attributes": [...]} when the outside card must be support for a monster Type or Attribute; or null,
  "phrases": ["game terms that must all appear in the outside card's printed text"]
}

An event is {"verbs": [...], "from": [...], "player": "you" | "opponent" | "any", "self": true | false, "what": {...}}:
- "verbs": one or more verbs from the list below. A card fits if it has any of them.
- "from": the zones the affected cards come from. [] when it does not matter.
- "player": whose cards are affected, from the side of the player using the outside card. Use "you" for your own cards.
- "self": true when the event is about the outside card itself: it Special Summons itself, or it reacts to itself being Tributed.
- "what": which cards are affected, as {"kinds": [], "subtypes": [], "types": [], "attributes": [], "level_min": 0, "level_max": 0}. Empty lists and 0 mean any card.

When the event is something done TO this archetype's cards (discarding them, sending them to the GY, Tributing them), fill "what" with what those cards are: their kind, and the Type, Attribute or Level range they share. The engine then keeps outside cards whose effect can reach them ("discard 1 card", "send 1 DARK monster") and drops the ones that cannot ("discard 1 Spell", "send 1 WATER monster"). Leave "what" empty only when any card will do.

"card" has the same shape as "what". A card must fit every part of a hook that is filled in.

# Where to look for hooks

Look for the places where this archetype touches the rest of the game:

1. Its triggers. Effects that begin "If this card is Tributed", "is sent to the GY", "is banished", "is discarded", "is destroyed" want outside cards that DO that to your own cards. Use "does".
2. Its costs. If the archetype discards, Tributes, banishes or detaches as a cost, outside cards with an effect when that happens to them get it for free. Use "reacts_to" with "self": true.
3. Its Summoning needs. If it needs Tributes, Tuners, monsters of a certain Level, Type or Attribute as material, or extra Normal Summons, outside cards that supply them fit. Use "card" and "does".
4. Its restrictions. If it locks you into one Type or Attribute, or all its monsters share one, generic support for that Type or Attribute fits. Use "supports".
5. Its payoffs. If it rewards something any deck could be built to do (Tribute Summoning, Ritual Summoning, controlling Continuous Spells, banishing face-down, placing counters), outside cards built around the same thing fit. Use "phrases", with "does" where a verb exists.
6. The monsters it rewards. Read the payoffs for wording like "your Tribute Summoned monsters", "a Ritual Monster you control", "Normal Monsters", "a Level 7 or higher monster". The deck gets better while you control such a monster and does not care which archetype it comes from, so outside monsters that ARE that kind fit, above all other archetypes' boss monsters. Give this its own hook: "card" with "kinds": ["monster"], plus a phrase those monsters print about themselves. For monsters with an easy Tribute Summon of their own, that is {"card": {"kinds": ["monster"], ...}, "phrases": ["Tribute Summon this card"]}.

# Rules

- Every hook must come from something specific in these cards. Do NOT list what every deck wants: hand traps, negation, draw power, removal, generic searchers, generic extenders.
- A hook is checked against one outside card on its own, so it must describe that card, not a combination.
- Prefer a few sharp hooks to many loose ones. The engine throws away a hook that fits more than about 700 cards, which is what happens to "banishes a card", "has an effect in the GY" or "Special Summons a monster". Narrow such a hook (whose cards, from which zone, what kind of card) or leave it out.
- Use "phrases" for game terms the verbs cannot tell apart, written exactly as cards print them: "Tribute Summon", "Ritual Monster", "Continuous Spell", "Pendulum Scale", "Xyz Material", "face-down Defense Position", "Counter". A phrase is matched literally against card text, so keep it to the one to three words every such card contains. The verb normal_summon covers Normal Summons, Tribute Summons and Sets alike, so a hook about Tribute Summoning needs the phrase.
- The verb change_position covers every change of battle position, ATK to DEF included. A hook about face-down monsters (setting them, flipping them back down) needs the phrase "face-down", or it also finds cards that only switch ATK and DEF.
- Never put the archetype's own name, or the names of its cards, in a hook. The point is to find cards that do not mention it.
- Describe the outside card from its own point of view: a card that Tributes your monsters has "does" tribute with "player": "you".
- Use only the terms listed below. Leave out, or set to null, [] or 0, whatever does not apply.

# Vocabulary

## Verbs
${glossary(VERBS)}

## Zones
${glossary(ZONES)}

## Card kinds
${CARD_KINDS.join(", ")}

## Subtypes
${SUBTYPES.join(", ")}

## Monster Types
${MONSTER_TYPES.join(", ")}

## Attributes
${ATTRIBUTES.join(", ")}

# Examples

${SYNERGY_EXAMPLES.map(({ archetype, profile }) => `Archetype: ${archetype}\n${JSON.stringify(profile)}`).join("\n\n")}`;
}

/** The message for one archetype: its name and its cards, best-known first. */
export function renderArchetype(name: string, cards: Card[]): string {
  const shown = [...cards].sort((a, b) => b.views - a.views).slice(0, MAX_CARDS_SHOWN);
  const count = shown.length < cards.length ? `${cards.length} cards; the ${shown.length} best-known are shown` : `${cards.length} cards`;
  return `Archetype: ${name} (${count})\n\n${shown.map(renderCard).join("\n\n")}`;
}
