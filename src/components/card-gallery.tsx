"use client";

import { useEffect, useRef, useState } from "react";
import { BAN_LIMITS, type Card } from "@/lib/card";
import { frameOf } from "@/lib/frame";
import { cardImageUrl, SMALL_CARD_IMAGE } from "@/lib/images";
import type { SearchResponse } from "@/lib/search-response";
import { CardRow, type DeckSlot } from "./card-row";

type Result = SearchResponse["results"][number];

/**
 * One card in the gallery: just its picture, for seeing many at once. Tapping it opens the card in
 * full. It keeps the marks worth seeing at a glance: how many are in the deck, and whether the TCG
 * list restricts it.
 */
export function GalleryCard({ result, copies, onOpen }: { result: Result; copies: number; onOpen: () => void }) {
  const { card } = result;
  const [missing, setMissing] = useState(false);
  const limit = card.banTcg ? BAN_LIMITS[card.banTcg] : null;
  return (
    <li className="gallery__card" data-card={card.id}>
      <button type="button" className="gallery__open" onClick={onOpen} aria-haspopup="dialog">
        {missing ? (
          <span className={`gallery__blank frame--${frameOf(card)}`}>{card.name}</span>
        ) : (
          <img
            className="gallery__art"
            src={cardImageUrl(card.id)}
            alt={card.name}
            width={SMALL_CARD_IMAGE.width}
            height={SMALL_CARD_IMAGE.height}
            loading="lazy"
            decoding="async"
            onError={() => setMissing(true)}
          />
        )}
        {limit !== null && (
          <span className={`limit limit--${limit} gallery__limit`} title={`${card.banTcg} in the TCG`}>
            <span aria-hidden="true">{limit || ""}</span>
            <span className="visually-hidden">, {card.banTcg} in the TCG</span>
          </span>
        )}
        {copies > 0 && (
          <span className="gallery__copies">
            <span aria-hidden="true">×</span>
            {copies}
            <span className="visually-hidden"> in the deck</span>
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * A card opened from the gallery, shown as its full tile over the page. The arrows (and the arrow
 * keys) step through the results without closing it.
 */
export function CardDialog({
  results,
  index,
  slotFor,
  onMove,
  onClose,
  onRelated,
}: {
  results: Result[];
  index: number | null;
  slotFor: (card: Card) => DeckSlot;
  onMove: (index: number) => void;
  onClose: () => void;
  /** Shows the cards related to this one, in place of the current results. */
  onRelated?: (card: Card) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const result = index === null ? undefined : results[index];

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (result && !dialog.open) dialog.showModal();
    if (!result && dialog.open) dialog.close();
  }, [result]);

  const step = (by: number) => {
    if (index === null) return;
    const next = index + by;
    if (next >= 0 && next < results.length) onMove(next);
  };

  return (
    <dialog
      ref={ref}
      className="carddialog"
      aria-label={result ? result.card.name : "Card"}
      onClose={onClose}
      onClick={(event) => {
        // A tap on the dimmed page around the card closes it.
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") step(1);
        if (event.key === "ArrowLeft") step(-1);
      }}
    >
      {result && index !== null && (
        <>
          <div className="carddialog__bar">
            <button type="button" className="carddialog__button" aria-label="Previous card" disabled={index === 0} onClick={() => step(-1)}>
              ‹
            </button>
            <span className="carddialog__count">
              {index + 1} of {results.length}
            </span>
            <button type="button" className="carddialog__button" aria-label="Next card" disabled={index === results.length - 1} onClick={() => step(1)}>
              ›
            </button>
            <button type="button" className="carddialog__button carddialog__close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
          <ol className="cards carddialog__card">
            <CardRow key={result.card.id} result={result} slot={slotFor(result.card)} onRelated={onRelated} />
          </ol>
        </>
      )}
    </dialog>
  );
}
