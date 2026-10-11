/**
 * Hand-written tags for a few well-known cards. They are shown to the model as worked examples, so
 * they define the tagging conventions in practice — change them deliberately, then re-tag.
 */
import {
  NO_FILTER,
  THIS_CARD,
  type CardFilter,
  type CardTags,
  type Effect,
  type GameEvent,
} from "../src/lib/tags.ts";

type Verb = GameEvent["verb"];
type Player = GameEvent["player"];
type Zone = GameEvent["from"][number];

const event = (
  verb: Verb,
  player: Player,
  rest: { from?: Zone[]; what?: Partial<CardFilter>; note?: string } = {},
): GameEvent => ({
  verb,
  player,
  from: rest.from ?? [],
  what: { ...NO_FILTER, ...rest.what },
  note: rest.note ?? "",
});

const effect = (
  timing: Effect["timing"],
  location: Zone[],
  rest: Partial<Omit<Effect, "timing" | "location">>,
): Effect => ({
  timing,
  location,
  limit: "none",
  targets: false,
  conditions: [],
  triggers: [],
  costs: [],
  actions: [],
  ...rest,
});

const NO_SUPPORT: CardTags["supports"] = { archetypes: [], names: [], types: [], attributes: [], subtypes: [] };

export const TAGGING_EXAMPLES: { name: string; tags: CardTags }[] = [
  {
    name: "Ash Blossom & Joyous Spring",
    tags: {
      summary:
        "Hand trap: discard it during either turn to negate an effect that adds a card from the Deck to the hand, Special Summons from the Deck, or sends a card from the Deck to the GY.",
      roles: ["hand_trap", "negation", "disruption"],
      keywords: ["anti-search", "stops searching", "stops mill", "ash"],
      effects: [
        effect("quick", ["hand"], {
          limit: "hard_once_per_turn",
          triggers: [
            event("activate", "either", {
              note: "a card or effect that adds from Deck to hand, Special Summons from the Deck, or sends from Deck to GY",
            }),
          ],
          costs: [event("discard", "you", { from: ["hand"], what: THIS_CARD })],
          actions: [event("negate_effect", "either", { note: "the activated effect" })],
        }),
      ],
      materials: [],
      supports: NO_SUPPORT,
    },
  },
  {
    name: "Reinforcement of the Army",
    tags: {
      summary: "Adds any Level 4 or lower Warrior monster from your Deck to your hand.",
      roles: ["searcher"],
      keywords: ["ROTA", "tutor", "warrior search"],
      effects: [
        effect("ignition", ["field"], {
          actions: [
            event("add_to_hand", "you", {
              from: ["deck"],
              what: { kinds: ["monster"], types: ["Warrior"], level_max: 4 },
            }),
          ],
        }),
      ],
      materials: [],
      supports: { ...NO_SUPPORT, types: ["Warrior"] },
    },
  },
  {
    name: "Elemental HERO Stratos",
    tags: {
      summary:
        'When Normal or Special Summoned, either searches any "HERO" monster from your Deck or destroys Spells/Traps up to the number of other "HERO" monsters you control.',
      roles: ["searcher", "backrow_removal"],
      keywords: ["on-summon search", "tutor", "pop backrow"],
      effects: [
        effect("trigger", ["field"], {
          triggers: [
            event("normal_summon", "you", { what: THIS_CARD }),
            event("special_summon", "you", { what: THIS_CARD }),
          ],
          actions: [
            event("destroy", "either", {
              from: ["field"],
              what: { kinds: ["spell", "trap"] },
              note: 'option 1: up to the number of other "HERO" monsters you control',
            }),
            event("add_to_hand", "you", {
              from: ["deck"],
              what: { kinds: ["monster"], archetypes: ["HERO"] },
              note: "option 2",
            }),
          ],
        }),
      ],
      materials: [],
      supports: { ...NO_SUPPORT, archetypes: ["HERO"] },
    },
  },
  {
    name: "Skill Drain",
    tags: {
      summary:
        "Continuous Trap floodgate: pay 1000 LP to activate it, then the effects of every face-up monster on the field are negated while it stays face-up.",
      roles: ["floodgate", "negation"],
      keywords: ["stun", "monster effect lock", "anti-meta"],
      effects: [
        effect("continuous", ["field"], {
          costs: [event("pay_lp", "you", { note: "1000 LP to activate the card" })],
          actions: [
            event("negate_effect", "either", {
              from: ["field"],
              what: { kinds: ["monster"], other: "face-up" },
              note: "all monsters, only while they are on the field; their effects can still be activated",
            }),
          ],
        }),
      ],
      materials: [],
      supports: NO_SUPPORT,
    },
  },
  {
    name: "Cyber Dragon",
    tags: {
      summary:
        "Level 5 monster that Special Summons itself from your hand for free while only your opponent controls a monster.",
      roles: ["extender"],
      keywords: ["going second", "free special summon", "self summon"],
      effects: [
        effect("condition", ["hand"], {
          conditions: ["only your opponent controls a monster"],
          actions: [event("special_summon", "you", { from: ["hand"], what: THIS_CARD })],
        }),
      ],
      materials: [],
      supports: NO_SUPPORT,
    },
  },
  {
    name: "Tearlaments Kitkallos",
    tags: {
      summary:
        'Fusion Monster that, when Special Summoned, searches or mills any "Tearlaments" card; can also revive a "Tearlaments" monster from hand or GY by sending one of your monsters to the GY, and mills 5 when it is sent to the GY by an effect.',
      roles: ["searcher", "mill", "extender", "recursion"],
      keywords: ["foolish burial", "self mill", "revive", "tutor"],
      effects: [
        effect("trigger", ["field"], {
          limit: "hard_once_per_turn",
          triggers: [event("special_summon", "you", { what: THIS_CARD })],
          actions: [
            event("add_to_hand", "you", {
              from: ["deck"],
              what: { archetypes: ["Tearlaments"] },
              note: "option 1",
            }),
            event("send_to_gy", "you", {
              from: ["deck"],
              what: { archetypes: ["Tearlaments"] },
              note: "option 2: send the same card to the GY instead",
            }),
          ],
        }),
        effect("ignition", ["field"], {
          limit: "hard_once_per_turn",
          targets: true,
          actions: [
            event("special_summon", "you", {
              from: ["hand", "gy"],
              what: { kinds: ["monster"], archetypes: ["Tearlaments"] },
            }),
            event("send_to_gy", "you", {
              from: ["field"],
              what: { kinds: ["monster"] },
              note: "the targeted monster you control",
            }),
          ],
        }),
        effect("trigger", ["gy"], {
          limit: "hard_once_per_turn",
          triggers: [event("send_to_gy", "you", { what: THIS_CARD, note: "by card effect" })],
          actions: [event("send_to_gy", "you", { from: ["deck"], note: "top 5 cards of your Deck" })],
        }),
      ],
      materials: [
        { ...NO_FILTER, kinds: ["monster"], archetypes: ["Tearlaments"] },
        { ...NO_FILTER, kinds: ["monster"], types: ["Aqua"] },
      ],
      supports: { ...NO_SUPPORT, archetypes: ["Tearlaments"], types: ["Aqua"] },
    },
  },
];
