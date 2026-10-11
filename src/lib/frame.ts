import type { Card } from "./card.ts";

const FRAMES = ["link", "xyz", "synchro", "fusion", "ritual", "effect", "normal"] as const;

/** The colour of the physical card's frame, which is how players recognise card types at a glance. */
export function frameOf(card: Card): string {
  if (card.kind !== "monster") return card.kind;
  return FRAMES.find((frame) => card.subtypes.includes(frame)) ?? "effect";
}
