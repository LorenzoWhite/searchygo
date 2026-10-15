"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "./card";
import type { CardNotes } from "./search";
import { EMPTY_DECK, SECTIONS, addCopy, copiesIn, deckSize, homeSection, moveCopy, parseDeck, removeCopy, whyNot, type Deck, type DeckList, type Section } from "./deck";

/** The deck is kept in the browser, so it is still there on the next visit. */
const STORAGE_KEY = "effect-search:deck";

interface Lookup {
  /** Keyed by the passcode that was asked for, which may be an alternate artwork's. */
  cards: Record<string, Card>;
  /** Keyed by the card's own passcode. */
  notes: Record<string, CardNotes>;
  unknown: number[];
}

const idsIn = (list: DeckList) => [...new Set(SECTIONS.flatMap((section) => list[section]))];

async function lookUp(ids: number[]): Promise<Lookup> {
  // Sorted, so the same cards are always asked for with the same address and a cached answer can be reused.
  ids = [...ids].sort((a, b) => a - b);
  if (!ids.length) return { cards: {}, notes: {}, unknown: [] };
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
  /** The summary and roles of each card in the deck, for opening it from there. */
  const [notes, setNotes] = useState<ReadonlyMap<number, CardNotes>>(() => new Map());
  /** Cards whose notes have been asked for, so each is asked for once. */
  const asked = useRef(new Set<number>());
  /** False until the saved deck has been read, so an empty deck is never saved over it. */
  const [ready, setReady] = useState(false);
  /** The deck as it was before an import or a clear, kept until the next edit so it can be put back. */
  const [previous, setPrevious] = useState<Deck | null>(null);

  const learn = useCallback((found: Card[], foundNotes: Lookup["notes"] = {}) => {
    setCards((known) => new Map([...known, ...found.map((card) => [card.id, card] as const)]));
    const noted = Object.entries(foundNotes).map(([id, note]) => [Number(id), note] as const);
    for (const [id] of noted) asked.current.add(id);
    if (noted.length) setNotes((known) => new Map([...known, ...noted]));
  }, []);

  useEffect(() => {
    const saved = readSaved();
    setReady(true);
    if (!saved || !deckSize(saved)) return;
    setDeck(saved);
    for (const id of idsIn(saved)) asked.current.add(id);
    lookUp(idsIn(saved))
      .then(({ cards: found, notes: foundNotes }) => {
        learn(Object.values(found), foundNotes);
        // A card that has since left the database is dropped rather than left as a blank row.
        setDeck((current) => (current === saved ? { ...saved, ...settle(saved, found) } : current));
      })
      .catch(() => {});
  }, [learn]);

  // Cards added from the search arrive without their notes; fetch them once the deck settles.
  useEffect(() => {
    if (!ready) return;
    const missing = idsIn(deck).filter((id) => !asked.current.has(id));
    if (!missing.length) return;
    const timer = setTimeout(() => {
      for (const id of missing) asked.current.add(id);
      lookUp(missing)
        .then(({ cards: found, notes: foundNotes }) => learn(Object.values(found), foundNotes))
        .catch(() => {
          for (const id of missing) asked.current.delete(id);
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [deck, ready, learn]);

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
        found = await lookUp(idsIn(list));
      } catch {
        return { ok: false, reason: "The cards could not be looked up. Check the connection and try again." };
      }
      const settled = settle(list, found.cards);
      if (!deckSize(settled)) return { ok: false, reason: "None of the cards in that deck were recognised." };
      learn(Object.values(found.cards), found.notes);
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

  return { deck, cards, notes, ready, add, remove, move, rename, clear, importDeck, undo: previous ? undo : null };
}

export type DeckControls = ReturnType<typeof useDeck>;
