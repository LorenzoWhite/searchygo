/** Builds the instructions for the counters job. The per-archetype message is the synergy job's. */
import * as z from "zod";
import { ATTRIBUTES, CARD_KINDS, MONSTER_TYPES, SUBTYPES } from "../src/lib/card.ts";
import { CounterProfile, MAX_ANSWERS, MAX_WEAKNESSES } from "../src/lib/counters.ts";
import { ROLES } from "../src/lib/tags.ts";
import { VERBS, ZONES } from "../src/lib/vocabulary.ts";

const NOTHING = { kinds: [], subtypes: [], types: [], attributes: [], level_min: 0, level_max: 0 };

/**
 * Profiles written by hand. They show the model what a good profile looks like, and they stand as
 * the profiles of their own archetypes.
 */
export const COUNTER_EXAMPLES: { archetype: string; profile: CounterProfile }[] = [
  {
    archetype: "Tearlaments",
    profile: {
      plan: "Mills its own Deck so Tearlaments monsters sent to the GY by card effects Fusion Summon from the GY, ending on Fusion Monsters that negate.",
      weaknesses: [
        {
          label: "Mills from the Deck",
          why: "Every combo starts with an effect that sends cards from the Deck to the GY, and a hand trap that negates that send stops the engine before a Fusion happens.",
          when: "going_first",
          roles: ["hand_trap"],
          does: null,
          reacts_to: null,
          card: null,
          supports: null,
          phrases: ["from the Deck"],
        },
        {
          label: "Lives in the GY",
          why: "Scheiren, Havnis and Merrli activate in the GY, so banishing them from there takes away the Fusion before it happens.",
          when: "going_first",
          roles: [],
          does: { verbs: ["banish"], from: ["gy"], player: "opponent", self: false, what: { ...NOTHING, kinds: ["monster"] } },
          reacts_to: null,
          card: null,
          supports: null,
          phrases: [],
        },
        {
          label: "Needs cards to reach the GY",
          why: "The whole deck triggers on being sent to the GY, so anything that banishes cards instead of letting them go there turns it off.",
          when: "either",
          roles: [],
          does: null,
          reacts_to: null,
          card: null,
          supports: null,
          phrases: ["banished instead"],
        },
        {
          label: "Ends on a Fusion board",
          why: "Going second you face Kitkallos and Rulkallos, so cards that clear the field without targeting get past their negation.",
          when: "going_second",
          roles: ["board_breaker"],
          does: null,
          reacts_to: null,
          card: null,
          supports: null,
          phrases: [],
        },
      ],
      answers: [
        { name: "Ash Blossom & Joyous Spring", why: "Negates the effects that send Tearlaments from the Deck to the GY.", when: "going_first" },
        { name: "Dimension Shifter", why: "Every card sent to the GY is banished instead, so no Tearlaments ever triggers.", when: "going_first" },
        { name: "Macro Cosmos", why: "Banishes everything instead of sending it to the GY for as long as it stays.", when: "either" },
        { name: "Bystial Magnamhut", why: "Banishes a DARK Tearlaments from the GY before it can Fusion Summon.", when: "going_first" },
        { name: "Called by the Grave", why: "Banishes a Tearlaments in the GY and negates its effect.", when: "going_first" },
        { name: "Evenly Matched", why: "Banishes the Fusion board face-down at the end of the Battle Phase.", when: "going_second" },
      ],
    },
  },
  {
    archetype: "Snake-Eye",
    profile: {
      plan: "Special Summons Level 1 FIRE monsters from the hand or Deck and searches with Diabellstar, ending on Snake-Eyes Flamberge Dragon with monsters placed in the Spell & Trap Zone.",
      weaknesses: [
        {
          label: "Summons from the Deck",
          why: "Snake-Eye Ash and Oak Special Summon or search from the Deck, so a hand trap that negates Deck effects stops the first play.",
          when: "going_first",
          roles: ["hand_trap"],
          does: null,
          reacts_to: null,
          card: null,
          supports: null,
          phrases: ["from the Deck"],
        },
        {
          label: "Monster effects on the field",
          why: "Snake-Eye Ash and Diabellstar start the combo with effects on the field, so negating a face-up monster's effect ends the turn early.",
          when: "going_first",
          roles: [],
          does: { verbs: ["negate_effect"], from: ["field"], player: "opponent", self: false, what: { ...NOTHING, kinds: ["monster"] } },
          reacts_to: null,
          card: null,
          supports: null,
          phrases: [],
        },
        {
          label: "Summons many monsters",
          why: "A full combo Special Summons five or more monsters, which lets cards that punish that many Summons wipe the board mid-combo.",
          when: "going_first",
          roles: [],
          does: null,
          reacts_to: null,
          card: null,
          supports: null,
          phrases: ["Summoned 5 or more"],
        },
        {
          label: "Ends on a wide board",
          why: "It ends with Flamberge and Link Monsters plus monsters in the Spell & Trap Zone, so mass removal is the way through going second.",
          when: "going_second",
          roles: ["board_breaker"],
          does: null,
          reacts_to: null,
          card: null,
          supports: null,
          phrases: [],
        },
      ],
      answers: [
        { name: "Ash Blossom & Joyous Spring", why: "Negates Snake-Eye Ash's Special Summon from the Deck or Diabellstar's search.", when: "going_first" },
        { name: "Infinite Impermanence", why: "Negates Snake-Eye Ash or Diabellstar on the field.", when: "going_first" },
        { name: "Effect Veiler", why: "Negates the first Snake-Eye monster's effect on the field.", when: "going_first" },
        { name: "Nibiru, the Primal Being", why: "Tributes the board once the combo has Summoned five monsters.", when: "going_first" },
        { name: "Droll & Lock Bird", why: "Stops the searches after the first one.", when: "going_first" },
        { name: "Evenly Matched", why: "Banishes most of the end board, including the cards in the Spell & Trap Zone.", when: "going_second" },
      ],
    },
  },
  {
    // Checked by a Clown Crew player: banishing does not hurt it, stopping its searches and draws does.
    archetype: "Clown Crew",
    profile: {
      plan: "Tributes its own monsters to Tribute Summon, sometimes during the opponent's turn, so every Clown Crew monster's 'If this card is Tributed' effect searches, draws or removes, ending on a Tribute Summoned Biancaviso that draws and negates.",
      weaknesses: [
        {
          label: "Searches and draws from the Deck",
          why: "Flair, Rehearsal and Soiree Operations search and Biancaviso draws, so a hand trap that stops cards being added from the Deck strips the deck of its fuel.",
          when: "going_first",
          roles: ["hand_trap"],
          does: null,
          reacts_to: null,
          card: null,
          supports: null,
          phrases: ["Deck to the hand"],
        },
        {
          label: "Monster effects on the field",
          why: "Biancaviso's draw and negation and the Quick Effect Tribute Summons are monster effects on the field, so negating a face-up monster stops the payoff.",
          when: "going_first",
          roles: [],
          does: { verbs: ["negate_effect"], from: ["field"], player: "opponent", self: false, what: { ...NOTHING, kinds: ["monster"] } },
          reacts_to: null,
          card: null,
          supports: null,
          phrases: [],
        },
        {
          label: "Everything runs on Tributes",
          why: "Every Clown Crew effect triggers when the card is Tributed and the deck Tribute Summons every turn, so a floodgate on Tributing shuts all of it off.",
          when: "either",
          roles: ["floodgate"],
          does: null,
          reacts_to: null,
          card: null,
          supports: null,
          phrases: ["Tribute"],
        },
        {
          label: "Ends on a Tribute Summoned board",
          why: "Going second you face Biancaviso with its negation and backrow, so non-targeting board breakers get through.",
          when: "going_second",
          roles: ["board_breaker"],
          does: null,
          reacts_to: null,
          card: null,
          supports: null,
          phrases: [],
        },
      ],
      answers: [
        { name: "Ash Blossom & Joyous Spring", why: "Negates the searches and the Special Summons from the Deck the combo runs on.", when: "going_first" },
        { name: "Droll & Lock Bird", why: "Stops every search and draw after the first, which starves the deck.", when: "going_first" },
        { name: "Effect Veiler", why: "Negates Biancaviso's draw, or the first Clown Crew monster effect on the field.", when: "going_first" },
        { name: "Infinite Impermanence", why: "Negates Biancaviso or the monster about to Tribute Summon.", when: "going_first" },
        { name: "Mask of Restrict", why: "Neither player can Tribute, which stops every Tribute Summon and every Tributed effect.", when: "either" },
        { name: "Evenly Matched", why: "Banishes the Tribute Summoned board and its backrow face-down.", when: "going_second" },
      ],
    },
  },
];

/** The profile schema as JSON Schema, without the keywords the structured-output API rejects. */
export function counterFormat(): { type: "json_schema"; schema: Record<string, unknown> } {
  const unsupported = new Set(["$schema", "minimum", "maximum"]);
  const schema = JSON.parse(
    JSON.stringify(z.toJSONSchema(CounterProfile, { reused: "ref" }), (key, value) => (unsupported.has(key) && typeof value !== "object" ? undefined : value)),
  ) as Record<string, unknown>;
  return { type: "json_schema", schema };
}

const glossary = (terms: Record<string, string>) =>
  Object.entries(terms)
    .map(([term, meaning]) => `- ${term}: ${meaning}`)
    .join("\n");

export function buildCounterPrompt(): string {
  return `You are helping build a search engine for Yu-Gi-Oh! cards. Every card in its database has been described in a fixed vocabulary: what each of its effects does, costs and reacts to, and which roles it plays (hand trap, floodgate, board breaker…). Players want to ask it "how do I beat this archetype?" and get the cards from OUTSIDE the archetype that stop it: the staples players side against it and the less obvious cards that hit what it relies on.

You will be given one archetype and its cards. Work out what the deck relies on and how each of those can be stopped, and describe the answering cards so the engine can pick them out of the database. Reply with a JSON object:

{
  "plan": "One sentence a player would recognise: how the deck wins, what it sets up and what board it ends on.",
  "weaknesses": [ 2 to ${MAX_WEAKNESSES} weaknesses ],
  "answers": [ up to ${MAX_ANSWERS} named cards ]
}

A weakness is ONE thing the deck relies on, described by the kind of outside card that stops it:

{
  "label": "Two to five words naming what the deck relies on, as a player would say it",
  "why": "One sentence: which of its cards rely on it, and how an answer stops them. Name the cards.",
  "when": "going_first" | "going_second" | "either",
  "roles": [roles the answering card must all have, from the list below],
  "does": an event the answering card causes; or null,
  "reacts_to": an event the answering card responds to; or null,
  "card": what the answering card itself must be; or null,
  "supports": null,
  "phrases": ["game terms that must all appear in the answering card's printed text"]
}

"when" is "going_first" for cards that stop the deck while it plays its combo (hand traps, negation, cards that stop its engine) and "going_second" for cards that break the board it ends on. Use "either" for cards that work both ways, like floodgates.

An event is {"verbs": [...], "from": [...], "player": "you" | "opponent" | "any", "self": true | false, "what": {...}}:
- "verbs": one or more verbs from the list below. A card fits if it has any of them.
- "from": the zones the affected cards come from. [] when it does not matter.
- "player": whose cards are affected, from the side of the player using the answering card. The deck being stopped belongs to "opponent".
- "self": true when the event is about the answering card itself.
- "what": which cards are affected, as {"kinds": [], "subtypes": [], "types": [], "attributes": [], "level_min": 0, "level_max": 0}. Empty lists and 0 mean any card. Fill it with what this deck's cards are (their kind, Type, Attribute) so answers that cannot reach them are left out.

"card" has the same shape as "what". A card must fit every part of a weakness that is filled in.

An answer is a card players actually use against this deck: {"name": "the card's exact English name", "why": "One sentence: what it stops", "when": ...}. Name the well-known staples that are strong here (Ash Blossom & Joyous Spring, Infinite Impermanence, Nibiru, the Primal Being, Dimension Shifter…) and any card that hard-counters this deck in particular. Only name cards whose effect really stops something this deck does, and only cards from outside this archetype.

# How to find weaknesses

1. Its engine. What does the first card of the combo do: search, Special Summon from the Deck, mill, use the GY, banish? A hand trap or effect that stops that stops the deck. Hand traps' text names what they stop, so a role and a phrase find them: {"roles": ["hand_trap"], "phrases": ["from the Deck"]}.
2. The zones it lives in. Only a deck whose effects ACTIVATE in the GY ("you can banish this card from your GY", effects that Special Summon themselves from the GY) loses to cards that banish from the GY or banish instead of sending there. A trigger on being sent, Tributed, destroyed or discarded still happens when the card is banished instead, so it is no weakness to GY hate; do not list D.D. Crow, Dimension Shifter or the like for such a deck.
3. Its draws and searches. A deck that keeps adding cards from the Deck, by searching or by drawing with card effects, loses to cards that stop that: Ash Blossom negates the search, Droll & Lock Bird stops every add after the first, draws included.
4. Its monsters' effects. If the combo runs on monster effects on the field, negating them stops it: "does" negate_effect on the opponent's monsters.
5. How much it Summons. Decks that Special Summon many times lose to cards that punish it ("Summoned 5 or more") or forbid it (floodgates).
6. What it shares. If all its monsters are one Type, Attribute or Summoning method, floodgates and cards that hit that one thing stop all of them.
7. Its end board. Going second, what does it end on and what gets through: board breakers, mass removal, cards that answer negation or protection. If the board stands on face-up Continuous Spells/Traps or a Field Spell (monsters that leave when the Trap does, protection from a Continuous card), Spell/Trap removal like Harpie's Feather Duster breaks it: give that its own weakness with the role backrow_removal.

# Rules

- Every weakness must come from something specific in these cards. "Draws a hand" or "plays monsters" is not a weakness.
- A weakness is checked against one answering card on its own, so it must describe that card.
- Use "phrases" for game terms the verbs cannot tell apart, written exactly as cards print them ("from the Deck", "banished instead", "Summoned 5 or more", "cannot Special Summon"). A phrase is matched literally against card text, so keep it to the one to four words every such card contains.
- Never put the archetype's own name, or the names of its cards, in a weakness.
- Use only the terms listed below. Leave out, or set to null, [] or 0, whatever does not apply.

# Vocabulary

## Roles
${glossary(ROLES)}

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

${COUNTER_EXAMPLES.map(({ archetype, profile }) => `Archetype: ${archetype}\n${JSON.stringify(profile)}`).join("\n\n")}`;
}
