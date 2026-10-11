"use client";

import { useCallback, useEffect, useState } from "react";
import type { Card } from "./card";
import { EMPTY_DECK, SECTIONS, addCopy, copiesIn, deckSize, homeSection, moveCopy, parseDeck, removeCopy, whyNot, type Deck, type DeckList, type Section } from "./deck";

/** The deck is kept in the browser, so it is still there on the next visit. */
const STORAGE_KEY = "effect-search:deck";

interface Lookup {
  /** Keyed by the passcode that was asked for, which may be an alternate artwork's. */
  cards: Record<string, Card>;
  unknown: number[];
}

async function lookUp(list: DeckList): Promise<Lookup> {
  // Sorted, so the same cards are always asked for with the same address and a cached answer can be reused.
  const ids = [...new Set(SECTIONS.flatMap((section) => list[section]))].sort((a, b) => a - b);
  if (!ids.length) return { cards: {}, unknown: [] };
  const response = await fetch(`/api/cards?ids=${ids.join(",")}`);
  if (!response.ok) throw new Error(`Card lookup responded ${response.status}`);
  return (await response.json()) as Lookup;
}

/** Swaps every passcode for its card's own, leaving out the ones no card answers to. */
function settle(list: DeckList, found: Lookup["cards"]): DeckList {
  const known = (ids: number[]) => ids.flatMap((id) => (found[id] ? [found[id].id] : []));
  return { main: known(list.main), extra: known(list.extra), side: known(list.side) };
}

function readSaved(): Deck | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Deck> | null;
    const isList = (value: unknown): value is number[] => Array.isArray(value) && value.every((id) => Number.isInteger(id));
    if (!saved || !SECTIONS.every((section) => isList(saved[section]))) return null;
    return { name: typeof saved.name === "string" ? saved.name : "", main: saved.main!, extra: saved.extra!, side: saved.side! };
  } catch {
    // Storage can be switched off or hold something unreadable; either way there is no deck to restore.
    return null;
  }
}

export type ImportResult = { ok: true; cards: number; unknown: number } | { ok: false; reason: string };

export function useDeck() {
  const [deck, setDeck] = useState<Deck>(EMPTY_DECK);
  /** Every card the deck has needed so far, by passcode. */
  const [cards, setCards] = useState<ReadonlyMap<number, Card>>(() => new Map());
  /** False until the saved deck has been read, so an empty deck is never saved over it. */
  const [ready, setReady] = useState(false);
  /** The deck as it was before an import or a clear, kept until the next edit so it can be put back. */
  const [previous, setPrevious] = useState<Deck | null>(null);

  const learn = useCallback((found: Card[]) => {
    setCards((known) => new Map([...known, ...found.map((card) => [card.id, card] as const)]));
  }, []);

  useEffect(() => {
    const saved = readSaved();
    setReady(true);
    if (!saved || !deckSize(saved)) return;
    setDeck(saved);
    lookUp(saved)
      .then(({ cards: found }) => {
        learn(Object.values(found));
        // A card that has since left the database is dropped rather than left as a blank row.
        setDeck((current) => (current === saved ? { ...saved, ...settle(saved, found) } : current));
      })
      .catch(() => {});
  }, [learn]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
    } catch {
      // Without storage the deck simply lasts for this visit.
    }
  }, [deck, ready]);

  const edit = useCallback((change: (deck: Deck) => Deck) => {
    setPrevious(null);
    setDeck(change);
  }, []);

  /** Adds a copy to the given section, or to where the card belongs. Returns why not when it cannot. */
  const add = useCallback(
    (card: Card, section: Section = homeSection(card)): string | null => {
      const reason = whyNot(deck, card, section);
      if (reason) return reason;
      learn([card]);
      edit((current) => (whyNot(current, card, section) ? current : addCopy(current, card.id, section)));
      return null;
    },
    [deck, edit, learn],
  );

  /** Takes a copy out of the given section, or out of wherever one is, the Side Deck last. */
  const remove = useCallback(
    (id: number, section?: Section) => {
      edit((current) => {
        const from = section ?? (["main", "extra", "side"] as const).find((candidate) => copiesIn(current, id, candidate));
        return from ? removeCopy(current, id, from) : current;
      });
    },
    [edit],
  );

  const move = useCallback((id: number, from: Section, to: Section) => edit((current) => moveCopy(current, id, from, to)), [edit]);
  const rename = useCallback((name: string) => setDeck((current) => ({ ...current, name })), []);

  const clear = useCallback(() => {
    setPrevious(deck);
    setDeck({ ...EMPTY_DECK, name: deck.name });
  }, [deck]);

  /** Replaces the deck with one read from a .ydk file's contents or a YDKe link. */
  const importDeck = useCallback(
    async (text: string, name: string): Promise<ImportResult> => {
      const list = parseDeck(text);
      if (!list) return { ok: false, reason: "That is not a .ydk file or a YDKe link." };
      if (!deckSize(list)) return { ok: false, reason: "That deck has no cards in it." };
      let found: Lookup;
      try {
        found = await lookUp(list);
      } catch {
        return { ok: false, reason: "The cards could not be looked up. Check the connection and try again." };
      }
      const settled = settle(list, found.cards);
      if (!deckSize(settled)) return { ok: false, reason: "None of the cards in that deck were recognised." };
      learn(Object.values(found.cards));
      setPrevious(deck);
      setDeck({ name, ...settled });
      return { ok: true, cards: deckSize(settled), unknown: deckSize(list) - deckSize(settled) };
    },
    [deck, learn],
  );

  const undo = useCallback(() => {
    if (!previous) return;
    setDeck(previous);
    setPrevious(null);
  }, [previous]);

  return { deck, cards, ready, add, remove, move, rename, clear, importDeck, undo: previous ? undo : null };
}

export type DeckControls = ReturnType<typeof useDeck>;
