/**
 * The fixed vocabulary of the tag schema, with a plain-English description of every term.
 * Kept free of dependencies so the browser bundle can use the labels without pulling in the schema.
 */

export const ZONES = {
  hand: "Hand",
  deck: "Main Deck",
  extra_deck: "Extra Deck",
  field: "Field (Monster Zone, Spell & Trap Zone or Field Zone)",
  pendulum_zone: "Pendulum Zone",
  gy: "Graveyard",
  banished: "Banished",
  attached: "Attached to an Xyz Monster as material",
} as const;

/** Things that happen in a duel. Used for what an effect does, what it costs, and what it reacts to. */
export const VERBS = {
  // Moving cards
  add_to_hand: "Add a card to the hand (from Deck = searching, from GY/banished = recovery)",
  draw: "Draw cards",
  special_summon: "Special Summon a monster, by effect or by the card's own Summoning procedure",
  normal_summon: "Normal Summon, Tribute Summon or Set a monster, incl. gaining extra Normal Summons",
  set_spell_trap: "Set a Spell/Trap, e.g. directly from the Deck or GY",
  place_on_field:
    "Put a card face-up on the field without Summoning it: Field Spells from Deck, Pendulum Scales, Continuous Spells/Traps, monsters placed as Spells",
  send_to_gy: "Send a card to the GY (not by destroying or discarding it)",
  discard: "Discard from the hand",
  destroy: "Destroy a card by card effect",
  banish: "Banish a card",
  return_to_hand: "Return a card on the field to the hand (bounce)",
  return_to_deck: "Return or shuffle a card into the Main Deck or Extra Deck",
  leave_field: "A card leaves the field, by any means",
  tribute: "Tribute a monster",
  attach_material: "Attach a card to an Xyz Monster as material",
  detach_material: "Detach Xyz material",
  equip: "Equip a card to a monster",
  take_control: "Take control of an opponent's monster",
  summon_token: "Special Summon Tokens",
  excavate: "Excavate cards from the top of the Deck",
  reveal_or_look: "Reveal or look at cards (hand, Deck, Extra Deck, Set cards)",
  // Extra Deck and Ritual Summons
  fusion_summon: "Fusion Summon",
  synchro_summon: "Synchro Summon",
  xyz_summon: "Xyz Summon",
  link_summon: "Link Summon",
  ritual_summon: "Ritual Summon",
  pendulum_summon: "Pendulum Summon",
  used_as_material: "A card is used as Fusion/Synchro/Xyz/Link material or Tributed for a Ritual Summon",
  // Negation
  negate_activation: "Negate the activation of a card or effect",
  negate_effect: "Negate an effect, or negate the effects of a card on the field",
  negate_summon: "Negate a Summon",
  negate_attack: "Negate an attack",
  // Stats and state
  change_atk_def: "Raise, lower or set ATK/DEF",
  change_level: "Change a Level or Rank",
  change_attribute_or_type: "Change or add an Attribute or monster Type",
  change_name: "A card's name is changed or treated as another card's name",
  change_position: "Change battle position, incl. flipping face-down",
  flip: "A monster is flipped face-up or Flip Summoned",
  place_counter: "Place counters",
  remove_counter: "Remove counters",
  // Life Points
  inflict_damage: "Inflict effect damage (burn)",
  gain_lp: "Gain Life Points",
  pay_lp: "Pay Life Points",
  prevent_damage: "Prevent, reduce or redirect damage",
  // Battle
  attack: "An attack is declared",
  battle: "A monster battles (Damage Step and damage calculation timing)",
  destroy_by_battle: "A monster is destroyed by battle",
  inflict_battle_damage: "Battle damage is inflicted",
  attack_directly: "Attack directly",
  attack_again: "Make additional attacks, or attack every monster",
  piercing: "Inflict piercing battle damage",
  // Protection and restrictions
  prevent_destruction: "Cannot be destroyed by battle and/or by card effects",
  prevent_targeting: "Cannot be targeted by card effects or for attacks",
  unaffected: "Unaffected by card effects",
  prevent_other: "Other protection: cannot be banished, Tributed, returned, have control changed, etc.",
  restrict_summon: "A player cannot Summon, or can only Summon certain monsters",
  restrict_activation: "A player cannot activate certain cards or effects, or cannot respond",
  restrict_attack: "Monsters cannot attack, or attacks are limited",
  restrict_other: "Any other lock: skip a phase, cannot draw, cannot Set, hand size, etc.",
  // Misc
  activate: "A card or effect is activated (the trigger for negations and other chain responses)",
  copy_effect: "Copy or gain another card's effects",
  phase: "A phase or turn begins or ends (say which in `note`)",
  win_duel: "Win the Duel by an alternate condition",
  other: "Anything not covered above (describe it in `note`)",
} as const;

export const TIMINGS = {
  ignition: "You choose to use it during your own Main Phase (monster Ignition Effects, Normal/Field/Equip/Ritual/Continuous Spell activations)",
  trigger: "Activates when or if a specific event happens, or at a specific phase",
  quick: "Can be used during either player's turn (Quick Effects, Quick-Play Spells, Traps)",
  continuous: "Always applies while its condition is met; it is never activated",
  condition: "Not an effect: Summoning procedures and conditions, materials, and other rules text",
} as const;

export const LIMITS = {
  none: "No limit stated",
  soft_once_per_turn: '"Once per turn" tied to this copy of the card',
  hard_once_per_turn: '"You can only use this effect of [name] once per turn" / "You can only activate 1 [name] per turn"',
  once_per_duel: "Once per Duel",
  other: "Any other limit (twice per turn, once per Chain, once while face-up…)",
} as const;

/** How players describe what a card is for. A card can have several roles, or none. */
export const ROLES = {
  hand_trap: "Has an effect that activates from the hand during the opponent's turn to disrupt them",
  floodgate: "Continuous lock that restricts what one or both players can do",
  searcher: "Adds a card from the Deck to the hand",
  extender: "A Main Deck card that Special Summons itself or another monster cheaply, adding bodies to a combo",
  removal: "Removes an opponent's card from the field (destroy, banish, bounce, spin, send to GY, Tribute)",
  mass_removal: "Removes many cards at once (board wipe)",
  board_breaker: "Going-second card that dismantles an established board",
  backrow_removal: "Removes Spells/Traps",
  negation: "Negates activations, effects, Summons or attacks",
  disruption: "Stops or undoes the opponent's plays during their own turn (hand traps, Traps, Quick Effects that negate or remove)",
  recursion: "Gets cards back from the GY or banishment (to hand, field or Deck)",
  draw_power: "Draws cards",
  mill: "Sends cards from its owner's Deck to the GY",
  gy_hate: "Attacks the opponent's GY (banishing it, shuffling it back, or shutting off GY effects)",
  hand_disruption: "Discards, removes or reveals cards in the opponent's hand",
  burn: "Inflicts effect damage",
  lp_gain: "Gains Life Points",
  protection: "Protects its owner's cards from destruction, targeting, negation or effects",
  stat_change: "Raises or lowers ATK/DEF",
  battle_trick: "Wins or swings a battle when used during the Battle Phase",
  stall: "Stops or delays attacks and damage",
  control_change: "Takes control of opponent's monsters",
  token_generator: "Creates Tokens",
  summon_enabler: "Its effect performs a Fusion, Ritual, Synchro, Xyz, Link or Pendulum Summon",
  alternate_win: "Wins or helps win the Duel by an alternate condition",
} as const;
