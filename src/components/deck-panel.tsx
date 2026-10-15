"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { GAMES, MD_RARITIES, MD_RARITY_NAMES, type Card } from "@/lib/card";
import {
  GENESYS_CAP,
  SECTIONS,
  SECTION_LIMITS,
  SECTION_NAMES,
  deckSize,
  homeSection,
  stacks,
  summarize,
  toYdk,
  toYdke,
  whyNot,
  type Section,
} from "@/lib/deck";
import { frameOf } from "@/lib/frame";
import { cardImageUrl } from "@/lib/images";
import type { DeckControls } from "@/lib/use-deck";
import { RollingNumber } from "./rolling-number";

/** Far larger than any deck file, which is a few hundred bytes. */
const MAX_FILE_BYTES = 100_000;

const EMPTY_SECTION: Record<Section, string> = {
  main: "Add cards with the + Deck button under a card in the search.",
  extra: "Fusion, Synchro, Xyz and Link Monsters go here when you add them.",
  side: "Move cards here from the Main or Extra Deck with their Side button.",
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A file name made from the deck's name, keeping only what every system accepts. */
const fileNameFor = (name: string) => `${name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "deck"}.ydk`;

interface DeckPanelProps {
  controls: DeckControls;
  open: boolean;
  onClose: () => void;
  /** Where a card sent from the search lands while the panel is open. */
  landingRef: RefObject<HTMLSpanElement | null>;
  /** Opens a card in full, with the rest of its section to step through. */
  onOpenCard: (cards: Card[], index: number) => void;
}

export function DeckPanel({ controls, open, onClose, landingRef, onOpenCard }: DeckPanelProps) {
  const { deck, cards, add, remove, move, rename, clear, importDeck, undo } = controls;
  const panelRef = useRef<HTMLElement>(null);
  const [importing, setImporting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [status, setStatus] = useState("");
  /** A YDKe link shown for copying by hand when the clipboard cannot be written to. */
  const [link, setLink] = useState("");

  const summary = useMemo(() => summarize(deck, cards), [deck, cards]);
  const size = deckSize(deck);

  // Opening the panel puts the keyboard in it; Escape hands it back.
  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  const download = () => {
    const name = fileNameFor(deck.name);
    const url = URL.createObjectURL(new Blob([toYdk(deck)], { type: "text/plain" }));
    Object.assign(document.createElement("a"), { href: url, download: name }).click();
    URL.revokeObjectURL(url);
    setStatus(`Saved ${name}.`);
  };

  const copyLink = async () => {
    const ydke = toYdke(deck);
    try {
      await navigator.clipboard.writeText(ydke);
      setLink("");
      setStatus("YDKe link copied.");
    } catch {
      setLink(ydke);
      setStatus("The clipboard is not available here, so the link is below to copy by hand.");
    }
  };

  const bringIn = async (text: string, name: string) => {
    setStatus("Reading the deck…");
    const result = await importDeck(text, name);
    if (!result.ok) return setStatus(result.reason);
    setImporting(false);
    setPasted("");
    setLink("");
    setStatus(`Imported ${plural(result.cards, "card")}${result.unknown ? `; ${plural(result.unknown, "card")} not recognised and left out` : ""}.`);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so that choosing the same file again still counts as a change.
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setStatus("That file is too large to be a deck.");
    await bringIn(await file.text(), file.name.replace(/\.[^.]+$/, ""));
  };

  const empty = () => {
    clear();
    setLink("");
    setStatus(`Deck cleared (${plural(size, "card")}).`);
  };

  return (
    <aside
      className="deckbox"
      id="deck"
      ref={panelRef}
      tabIndex={-1}
      aria-label="Deck"
      data-open={open}
      inert={!open}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <header className="deckbox__head">
        <span className="deck" ref={landingRef} aria-hidden="true" />
        <input
          className="deckbox__name"
          aria-label="Deck name"
          placeholder="Untitled deck"
          value={deck.name}
          maxLength={60}
          onChange={(event) => rename(event.target.value)}
        />
        <button type="button" className="deckbox__close" aria-label="Close the deck" onClick={onClose}>
          ×
        </button>
      </header>

      <dl className="deckbox__tally">
        {GAMES.map((game) => {
          const breaches = summary.breaches[game];
          return (
            <div key={game}>
              <dt>{game} list</dt>
              <dd data-over={breaches.length > 0}>{size === 0 ? "—" : breaches.length ? `${plural(breaches.length, "card")} over` : "Nothing over"}</dd>
              {breaches.length > 0 && (
                <dd className="deckbox__breaches">
                  <ul>
                    {breaches.map(({ card, copies, allowed, standing }) => (
                      <li key={card.id}>
                        {card.name} ×{copies}: {standing === "Unreleased" ? `not released in the ${game}` : `${standing}, ${allowed === 0 ? "none allowed" : `${allowed} allowed`}`}
                      </li>
                    ))}
                  </ul>
                </dd>
              )}
            </div>
          );
        })}
        <div>
          <dt>Genesys</dt>
          <dd data-over={summary.genesysPoints > GENESYS_CAP || summary.genesysBarred > 0}>
            <RollingNumber value={summary.genesysPoints} /> / {GENESYS_CAP} pts
            {summary.genesysBarred > 0 && ` · ${summary.genesysBarred} not legal`}
          </dd>
        </div>
        <div>
          <dt>Master Duel</dt>
          <dd className="deckbox__rarities">
            {[...MD_RARITIES].reverse().map((rarity) => (
              <span key={rarity} title={MD_RARITY_NAMES[rarity]}>
                <span className={`rarity rarity--${rarity.toLowerCase()}`}>
                  <span aria-hidden="true">{rarity}</span>
                  <span className="visually-hidden">{MD_RARITY_NAMES[rarity]}</span>
                </span>{" "}
                {summary.rarities[rarity]}
              </span>
            ))}
            {summary.notInMasterDuel > 0 && <span>{summary.notInMasterDuel} not in the game</span>}
          </dd>
        </div>
      </dl>

      {SECTIONS.map((section) => {
        const count = deck[section].length;
        const { min, max } = SECTION_LIMITS[section];
        const rows = stacks(deck[section], cards);
        return (
          <section className="deckbox__zone" key={section} aria-labelledby={`deck-${section}`}>
            <div className="deckbox__zonehead">
              <h2 id={`deck-${section}`}>{SECTION_NAMES[section]}</h2>
              <p data-over={count > max} data-short={count < min}>
                <RollingNumber value={count} /> / {min ? `${min}–${max}` : max}
              </p>
            </div>
            {section === "main" && count > 0 && (
              <p className="deckbox__kinds">
                {plural(summary.monsters, "monster")} · {plural(summary.spells, "Spell")} · {plural(summary.traps, "Trap")}
              </p>
            )}
            {rows.length > 0 ? (
              <ol className="deckbox__list">
                {rows.map(({ card, copies }, at) => {
                  const other: Section = section === "side" ? homeSection(card) : "side";
                  const full = deck[other].length >= SECTION_LIMITS[other].max;
                  const blocked = whyNot(deck, card, section);
                  return (
                    <li className={`deckrow frame--${frameOf(card)}`} key={card.id}>
                      <button
                        type="button"
                        className="deckrow__open"
                        aria-haspopup="dialog"
                        title={`Show ${card.name}`}
                        onClick={() => onOpenCard(rows.map((row) => row.card), at)}
                      >
                        <span className="deckrow__art" style={{ backgroundImage: `url("${cardImageUrl(card.id)}")` }} aria-hidden="true" />
                        <span className="deckrow__name">{card.name}</span>
                      </button>
                      <span className="deckrow__copies">
                        <span aria-hidden="true">×</span>
                        {copies}
                        <span className="visually-hidden"> {copies === 1 ? "copy" : "copies"}</span>
                      </span>
                      <span className="deckrow__actions">
                        <button type="button" aria-label={`Remove a copy of ${card.name}`} onClick={() => remove(card.id, section)}>
                          −
                        </button>
                        <button
                          type="button"
                          aria-label={`Add a copy of ${card.name}`}
                          title={blocked ?? undefined}
                          disabled={!!blocked}
                          onClick={() => add(card, section)}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className="deckrow__move"
                          aria-label={`Move a copy of ${card.name} to the ${SECTION_NAMES[other]}`}
                          title={full ? `The ${SECTION_NAMES[other]} is full` : `Move a copy to the ${SECTION_NAMES[other]}`}
                          disabled={full}
                          onClick={() => move(card.id, section, other)}
                        >
                          {SECTION_NAMES[other].split(" ")[0]}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="deckbox__empty">{count > 0 ? "Loading the cards…" : EMPTY_SECTION[section]}</p>
            )}
          </section>
        );
      })}

      <div className="deckbox__actions">
        <button type="button" className="button" disabled={size === 0} onClick={download}>
          Export .ydk
        </button>
        <button type="button" className="button" disabled={size === 0} onClick={copyLink}>
          Copy YDKe link
        </button>
        <button type="button" className="button" aria-expanded={importing} aria-controls="deck-import" onClick={() => setImporting((shown) => !shown)}>
          Import a deck
        </button>
        <button type="button" className="button button--quiet" disabled={size === 0} onClick={empty}>
          Clear the deck
        </button>
      </div>

      <div className="deckbox__import" id="deck-import" hidden={!importing}>
        <label className="button deckbox__file">
          Choose a .ydk file
          <input className="visually-hidden" type="file" accept=".ydk,text/plain" onChange={onFile} />
        </label>
        <div className="field">
          <label htmlFor="deck-paste">Or paste a YDKe link or the contents of a .ydk file</label>
          <textarea id="deck-paste" rows={3} spellCheck={false} value={pasted} onChange={(event) => setPasted(event.target.value)} />
        </div>
        <button type="button" className="button" disabled={pasted.trim() === ""} onClick={() => bringIn(pasted, deck.name || "Imported deck")}>
          Import the pasted deck
        </button>
        <p className="deckbox__note">Importing replaces the deck you have now. You can undo it straight after.</p>
      </div>

      {link && <input className="deckbox__link" aria-label="YDKe link" readOnly value={link} onFocus={(event) => event.target.select()} />}

      <p className="deckbox__status" role="status">
        {status}
        {undo && (
          <>
            {" "}
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                undo();
                setStatus("Put back the deck you had before.");
              }}
            >
              Undo
            </button>
          </>
        )}
      </p>
    </aside>
  );
}
