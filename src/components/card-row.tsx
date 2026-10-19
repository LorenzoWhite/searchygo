"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { BAN_LIMITS, GAMES, MD_RARITY_NAMES, isBarredFromGenesys, standingIn, type Attribute, type Card } from "@/lib/card";
import { MAX_COPIES } from "@/lib/deck";
import { frameOf } from "@/lib/frame";
import { cardImageUrl, SMALL_CARD_IMAGE } from "@/lib/images";
import { reflowMat, turnOver } from "@/lib/motion";
import { ROLES } from "@/lib/vocabulary";
import type { SearchResponse } from "@/lib/search-response";

type Result = SearchResponse["results"][number];

/** The two sides of a card's text box: its own wording, or the short version of what it does. */
type Side = "text" | "summary";
const SIDES: { side: Side; label: string; title?: string }[] = [
  { side: "text", label: "Card text" },
  { side: "summary", label: "Summary", title: "A machine-written summary. The card text is the exact wording." },
];

/** How a card on the mat stands with the deck being built, and what its buttons do about it. */
export interface DeckSlot {
  /** Copies already in the deck, across all three sections. */
  copies: number;
  /** Why another copy cannot be added, when it cannot. */
  blocked: string | null;
  /** `art` is the card's picture, which is what is seen going to the deck. */
  onAdd: (card: Card, art: HTMLElement | null) => void;
  onRemove: (card: Card) => void;
}

/** The character printed in each Attribute's orb on the cards. */
const ATTRIBUTE_GLYPHS: Record<Attribute, string> = {
  DARK: "闇",
  DIVINE: "神",
  EARTH: "地",
  FIRE: "炎",
  LIGHT: "光",
  WATER: "水",
  WIND: "風",
};

const stat = (value: number | null | undefined) => (value == null ? "?" : String(value));
const titleCase = (word: string) => (word === "xyz" ? "Xyz" : word[0]!.toUpperCase() + word.slice(1)).replace("_", "-");

/** The bracketed line printed at the top of a card's text box: [Zombie / Tuner / Effect]. */
function typeLine(card: Card): string {
  if (card.kind !== "monster") return card.typeLine;
  return [card.monsterType, ...card.subtypes.map(titleCase)].filter(Boolean).join(" / ");
}

/**
 * The card image in its pocket, or a blank card in the frame colour when there is no image for it.
 * The pocket stays put while the card lifts out of it under the pointer.
 */
function CardArt({ card, frame }: { card: Card; frame: string }) {
  const [missing, setMissing] = useState(false);
  return (
    <span className="tile__pocket">
      {missing ? (
        // A card with no picture yet (a new reveal) is its name on a blank, as in the gallery.
        <span className={`tile__art tile__art--missing frame--${frame}`} aria-hidden="true">
          {card.name}
        </span>
      ) : (
        // The name is the heading right beside it, so the image adds nothing for a screen reader.
        <img
          className="tile__art"
          src={cardImageUrl(card.id)}
          alt=""
          width={SMALL_CARD_IMAGE.width}
          height={SMALL_CARD_IMAGE.height}
          loading="lazy"
          decoding="async"
          onError={() => setMissing(true)}
        />
      )}
    </span>
  );
}

/** Level as the row of stars printed under a monster's name; Rank uses the same row in black. */
function Stars({ card }: { card: Card }) {
  const count = card.level ?? card.rank;
  if (count == null) return card.linkRating != null ? <p className="tile__rating">Link–{card.linkRating}</p> : null;
  const label = `${card.rank != null ? "Rank" : "Level"} ${count}`;
  return (
    <p className={`stars${card.rank != null ? " stars--rank" : ""}`} role="img" aria-label={label} title={label}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="star" />
      ))}
    </p>
  );
}

/**
 * Where the card can be played and what it costs there, for each way of playing that decides this
 * card by card: the TCG and OCG Forbidden & Limited lists, shown with the marks those lists use; its
 * rarity in Master Duel, as the foil stamp from the corner of a card; and its points in Genesys, on a
 * price tag. The TCG and OCG are only mentioned when a card is restricted or missing there.
 */
function Games({ card }: { card: Card }) {
  const { mdRarity, genesysPoints } = card;
  const barred = isBarredFromGenesys(card);
  return (
    <dl className="tile__games">
      {GAMES.map((game) => {
        const standing = standingIn(card, game);
        if (standing === "Unlimited") return null;
        if (standing === "Unreleased") {
          return (
            <div key={game}>
              <dt>{game}</dt>
              <dd>not released</dd>
            </div>
          );
        }
        const allowed = BAN_LIMITS[standing];
        const meaning = allowed === 0 ? "no copies allowed" : allowed === 1 ? "1 copy allowed" : `${allowed} copies allowed`;
        return (
          <div key={game} title={`${standing} in the ${game}: ${meaning}`}>
            <dt>{game}</dt>
            <dd className={`limit limit--${allowed}`}>
              <span aria-hidden="true">{allowed || ""}</span>
              <span className="visually-hidden">
                {standing}, {meaning}
              </span>
            </dd>
          </div>
        );
      })}
      <div>
        <dt>Master Duel</dt>
        {mdRarity ? (
          <dd className={`rarity rarity--${mdRarity.toLowerCase()}`} title={MD_RARITY_NAMES[mdRarity]}>
            <span aria-hidden="true">{mdRarity}</span>
            <span className="visually-hidden">{MD_RARITY_NAMES[mdRarity]}</span>
          </dd>
        ) : (
          <dd>not in game</dd>
        )}
      </div>
      {genesysPoints != null ? (
        <div>
          <dt>Genesys</dt>
          <dd className={`tag${genesysPoints > 0 ? " tag--costed" : ""}`}>
            {genesysPoints} {genesysPoints === 1 ? "pt" : "pts"}
          </dd>
        </div>
      ) : barred ? (
        <div title="Link and Pendulum Monsters cannot be used in Genesys">
          <dt>Genesys</dt>
          <dd>not legal</dd>
        </div>
      ) : null}
    </dl>
  );
}

/**
 * The deck controls under a card's picture. With none in the deck it is one button that says what
 * it does; after that it is a count in card-shaped pips with a button either side.
 */
function Copies({ card, slot, artOf }: { card: Card; slot: DeckSlot; artOf: () => HTMLElement | null }) {
  const { copies, blocked, onAdd, onRemove } = slot;
  return (
    <div className="copies" data-copies={copies} role="group" aria-label={`In the deck: ${copies}`}>
      <button type="button" className="copies__less" aria-label={`Remove a copy of ${card.name} from the deck`} disabled={copies === 0} onClick={() => onRemove(card)}>
        −
      </button>
      <span className="copies__pips" aria-hidden="true">
        {Array.from({ length: MAX_COPIES }, (_, index) => (
          <span key={index} data-filled={index < copies} />
        ))}
      </span>
      <button
        type="button"
        className="copies__more"
        aria-label={copies ? `Add another copy of ${card.name} to the deck` : `Add ${card.name} to the deck`}
        title={blocked ?? undefined}
        disabled={!!blocked}
        onClick={() => onAdd(card, artOf())}
      >
        +<span className="copies__word"> Deck</span>
      </button>
    </div>
  );
}

/** When a counter is played, as the "Stops" line says it. */
const WHEN = { going_first: "going first", going_second: "going second", either: "either way" } as const;

export function CardRow({ result, slot, onRelated }: { result: Result; slot: DeckSlot; onRelated?: (card: Card) => void }) {
  const { card, summary, roles, fits, stops, answer, related } = result;
  const frame = frameOf(card);
  const isMonster = card.kind === "monster";
  const tileRef = useRef<HTMLLIElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  /** A card shows its own wording until it is turned over to the summary, when it has one. */
  const [turned, setTurned] = useState<Side>("text");
  const side: Side = summary ? turned : "text";

  const turn = (to: Side) => {
    if (to === side || !tileRef.current || !copyRef.current) return;
    // The two sides differ in length, so the cards after this one slide to their new places.
    reflowMat(tileRef.current, () => flushSync(() => setTurned(to)));
    turnOver(copyRef.current);
  };

  return (
    <li className="tile" data-card={card.id} ref={tileRef}>
      <h2 className={`tile__plate frame--${frame}`}>
        <a href={card.url} target="_blank" rel="noreferrer">
          {card.name}
        </a>
        {card.attribute && (
          <span className={`orb orb--${card.attribute.toLowerCase()}`} role="img" aria-label={`${card.attribute} Attribute`} title={card.attribute}>
            {ATTRIBUTE_GLYPHS[card.attribute]}
          </span>
        )}
      </h2>

      <div className="tile__slot">
        <CardArt card={card} frame={frame} />
        <Copies card={card} slot={slot} artOf={() => tileRef.current?.querySelector<HTMLElement>(".tile__art") ?? null} />
        {onRelated && (
          <button type="button" className="tile__related" onClick={() => onRelated(card)}>
            Related cards
          </button>
        )}
      </div>

      <div className="tile__face">
        {isMonster && <Stars card={card} />}
        <p className="tile__type">[{typeLine(card)}]</p>
        {card.scale != null && <p className="tile__rating">Pendulum Scale {card.scale}</p>}
        {roles.length > 0 && (
          <ul className="tile__roles" aria-label="Roles">
            {roles.map((role) => (
              <li key={role} title={ROLES[role]}>
                {role.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        )}
        {answer && (
          <p className="tile__fits">
            <span>Answer · {WHEN[answer.when]}</span> {answer.why}
          </p>
        )}
        {stops && stops.length > 0 && (
          <p className="tile__fits">
            <span>Stops</span> {stops.map(({ label, when }) => `${label} (${WHEN[when]})`).join(" · ")}
          </p>
        )}
        {fits && fits.length > 0 && (
          <p className="tile__fits">
            <span>Fits</span> {fits.join(" · ")}
          </p>
        )}
        {related && related.length > 0 && (
          <p className="tile__fits">
            <span>Related</span> {related.join(" · ")}
          </p>
        )}
      </div>

      <div className="tile__text">
        {summary && (
          <div className="tile__sides" role="group" aria-label="Show">
            {SIDES.map(({ side: option, label, title }) => (
              <button key={option} type="button" aria-pressed={side === option} title={title} onClick={() => turn(option)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="tile__copy" ref={copyRef}>
          {side === "summary" ? (
            <p className="tile__summary">{summary}</p>
          ) : (
            <>
              {card.pendulumText && (
                <p className="tile__effect">
                  <span className="tile__label">Pendulum Effect</span>
                  {card.pendulumText}
                </p>
              )}
              <p className="tile__effect">{card.text}</p>
            </>
          )}
        </div>
      </div>

      <div className="tile__foot">
        <Games card={card} />
        {isMonster && (
          <p className="tile__stats">
            <span>ATK/{stat(card.atk)}</span>
            {card.def !== undefined && <span>DEF/{stat(card.def)}</span>}
          </p>
        )}
      </div>
    </li>
  );
}
