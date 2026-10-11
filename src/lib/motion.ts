/**
 * The site's motion, built on anime.js. Everything here treats results as physical cards on a mat:
 * they are dealt from a deck, slide to a new spot when a search reshuffles them, and drop off the
 * mat when they no longer match. All of it is skipped for visitors who ask for reduced motion.
 */
import { animate, createSpring, stagger, utils } from "animejs";

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A box in page coordinates, so it stays comparable if the page scrolls between two measurements. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

export interface MatSnapshot {
  /** Where every card sat, by card id. */
  boxes: Map<string, Box>;
  /** Copies of the cards that were on screen, kept so the ones that leave can be seen leaving. */
  visible: Map<string, HTMLElement>;
}

const TILE = "li[data-card]";
/** Cards this far outside the window are not animated: nobody would see it. */
const OFFSCREEN_MARGIN = 200;
/** Searches closer together than this are someone typing, and get a quick settle instead of a full deal. */
const TYPING_WINDOW_MS = 900;

const box = (element: Element): Box => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left + window.scrollX, top: rect.top + window.scrollY, width: rect.width, height: rect.height };
};

const onScreen = ({ top, height }: Box) =>
  top + height > window.scrollY - OFFSCREEN_MARGIN && top < window.scrollY + window.innerHeight + OFFSCREEN_MARGIN;

export const centreOf = (element: Element): Point => {
  const { left, top, width, height } = box(element);
  return { x: left + width / 2, y: top + height / 2 };
};

const clear = (element: HTMLElement) => {
  element.style.transform = "";
  element.style.opacity = "";
};

/** Records where the cards are, measured as they appear right now (mid-flight if they are moving). */
export function snapshotMat(list: HTMLElement | null): MatSnapshot {
  const snapshot: MatSnapshot = { boxes: new Map(), visible: new Map() };
  if (!list) return snapshot;
  for (const tile of list.querySelectorAll<HTMLElement>(TILE)) {
    const id = tile.dataset.card!;
    const at = box(tile);
    snapshot.boxes.set(id, at);
    if (onScreen(at) && !reducedMotion()) snapshot.visible.set(id, tile.cloneNode(true) as HTMLElement);
  }
  return snapshot;
}

/** Slides a card to where it now sits from an offset that puts it back where it was. */
const glide = (tile: HTMLElement, dx: number, dy: number, duration: number) =>
  animate(tile, { x: [dx, 0], y: [dy, 0], duration, ease: "outExpo", onComplete: () => clear(tile) });

let lastDeal = 0;

/**
 * Plays the change from `before` to what is now in `list`: cards that stayed slide to their new
 * places, new cards are dealt from `deck`, and cards that left drop off the mat.
 */
export function dealMat(list: HTMLElement, before: MatSnapshot, deck: Point, graveyard: HTMLElement | null) {
  const tiles = [...list.querySelectorAll<HTMLElement>(TILE)];
  utils.remove(tiles);
  tiles.forEach(clear);
  if (reducedMotion()) return;

  const now = performance.now();
  const typing = now - lastDeal < TYPING_WINDOW_MS;
  lastDeal = now;

  const present = new Set<string>();
  const entering: { tile: HTMLElement; at: Box }[] = [];
  for (const tile of tiles) {
    const id = tile.dataset.card!;
    present.add(id);
    const at = box(tile);
    const was = before.boxes.get(id);
    if (!was) {
      if (onScreen(at)) entering.push({ tile, at });
      continue;
    }
    const dx = was.left - at.left;
    const dy = was.top - at.top;
    if ((dx || dy) && (onScreen(at) || onScreen(was))) glide(tile, dx, dy, typing ? 260 : 460);
  }

  // Cards that no longer match fall away, unless the visitor is mid-word and it would only be noise.
  if (graveyard && !typing) {
    const frame = box(graveyard);
    for (const [id, ghost] of before.visible) {
      if (present.has(id)) continue;
      const was = before.boxes.get(id)!;
      ghost.removeAttribute("data-card");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      Object.assign(ghost.style, {
        position: "absolute",
        left: `${was.left - frame.left}px`,
        top: `${was.top - frame.top}px`,
        width: `${was.width}px`,
        height: `${was.height}px`,
        margin: "0",
        transform: "",
        opacity: "",
      });
      graveyard.append(ghost);
      animate(ghost, {
        y: 56,
        rotate: utils.random(-4, 4),
        scale: 0.96,
        opacity: 0,
        duration: 240,
        ease: "in(2)",
        onComplete: () => ghost.remove(),
      });
    }
  }

  // New cards fly out of the deck, each a beat after the last, and settle with a card's slight give.
  entering.forEach(({ tile, at }, index) => {
    animate(tile, {
      x: [deck.x - (at.left + at.width / 2), 0],
      y: [deck.y - (at.top + at.height / 2), 0],
      scale: [0.14, 1],
      rotate: [utils.random(-16, 16), 0],
      opacity: { from: 0, to: 1, duration: 140, ease: "linear" },
      delay: typing ? 0 : 90 + index * 55,
      duration: typing ? 280 : 640,
      ease: typing ? "outExpo" : createSpring({ stiffness: 150, damping: 17 }),
      onComplete: () => clear(tile),
    });
  });
}

/**
 * Runs a change that resizes one card where it lies (its text being turned over), then slides
 * the cards around it from where they were to where the change left them.
 */
export function reflowMat(tile: HTMLElement, change: () => void) {
  const tiles = [...(tile.parentElement?.querySelectorAll<HTMLElement>(TILE) ?? [])];
  if (reducedMotion()) return change();
  // Anything still in flight is set down first, so what is measured is the layout itself.
  utils.remove(tiles);
  tiles.forEach(clear);
  const before = tiles.map(box);
  change();
  tiles.forEach((other, index) => {
    const was = before[index]!;
    const at = box(other);
    const dx = was.left - at.left;
    const dy = was.top - at.top;
    if ((dx || dy) && (onScreen(at) || onScreen(was))) glide(other, dx, dy, 360);
  });
}

/** Turns a card's text over: the new side swings down from its top edge like a flap. */
export function turnOver(side: HTMLElement) {
  if (reducedMotion()) return;
  utils.remove(side);
  animate(side, { rotateX: [-78, 0], opacity: [0, 1], duration: 420, ease: "outExpo", onComplete: () => clear(side) });
}

/**
 * Sends a copy of a card's picture from its pocket to the deck: it lifts, arcs across the mat while
 * shrinking to the size of a card in a stack, and the deck takes it with a kick.
 */
export function sendToDeck(art: HTMLElement, deck: HTMLElement) {
  if (reducedMotion()) return;
  const from = art.getBoundingClientRect();
  const to = deck.getBoundingClientRect();
  const flying = art.cloneNode(true) as HTMLElement;
  flying.setAttribute("aria-hidden", "true");
  Object.assign(flying.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: "0",
    zIndex: "40",
    pointerEvents: "none",
    transform: "",
  });
  document.body.append(flying);
  animate(flying, {
    // Moving across at a steady pace while falling late is what bends the path into an arc.
    x: { to: to.left + to.width / 2 - (from.left + from.width / 2), ease: "out(1.6)" },
    y: { to: to.top + to.height / 2 - (from.top + from.height / 2), ease: "in(2.4)" },
    scale: { to: Math.max(0.12, to.height / from.height), ease: "in(2)" },
    rotate: utils.random(-28, 28),
    opacity: { to: 0, delay: 420, duration: 100, ease: "linear" },
    duration: 520,
    onComplete: () => {
      flying.remove();
      kickDeck(deck);
    },
  });
}

/** The deck gives a small kick each time it deals. */
export function kickDeck(deck: HTMLElement | null) {
  if (!deck || reducedMotion()) return;
  animate(deck, { scale: [0.82, 1], rotate: [-8, 0], duration: 420, ease: createSpring({ stiffness: 260, damping: 13 }) });
}

/** Rolls a number to its new value the way a Life Point counter ticks down. */
export function rollNumber(element: HTMLElement, from: number, to: number, format: (value: number) => string) {
  if (from === to || reducedMotion()) {
    element.textContent = format(to);
    return;
  }
  const counter = { value: from };
  animate(counter, {
    value: to,
    duration: 700,
    ease: "outExpo",
    onUpdate: () => {
      element.textContent = format(Math.round(counter.value));
    },
    onComplete: () => {
      element.textContent = format(to);
    },
  });
}

/** Presses labels onto the mat like a rubber stamp: large, slightly crooked, then square and inked. */
export function stamp(elements: Iterable<HTMLElement>) {
  const targets = [...elements];
  if (!targets.length || reducedMotion()) return;
  utils.remove(targets);
  animate(targets, {
    scale: [1.5, 1],
    rotate: [() => utils.random(-7, 7), 0],
    opacity: [0, 1],
    duration: 260,
    delay: stagger(70),
    ease: "outExpo",
    onComplete: () => targets.forEach(clear),
  });
}

/** Lifts a card part-way out of its pocket while the pointer is on it, and lets it drop back after. */
export function watchPockets(root: HTMLElement): () => void {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches || reducedMotion()) return () => {};
  const lift = createSpring({ stiffness: 240, damping: 15 });
  const artUnder = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>(".tile__art") : null);

  const onOver = (event: PointerEvent) => {
    const art = artUnder(event.target);
    if (!art || art === artUnder(event.relatedTarget)) return;
    animate(art, { y: -10, x: 3, rotate: -3, scale: 1.06, duration: 420, ease: lift });
  };
  const onOut = (event: PointerEvent) => {
    const art = artUnder(event.target);
    if (!art || art === artUnder(event.relatedTarget)) return;
    animate(art, { y: 0, x: 0, rotate: 0, scale: 1, duration: 420, ease: lift });
  };

  root.addEventListener("pointerover", onOver);
  root.addEventListener("pointerout", onOut);
  return () => {
    root.removeEventListener("pointerover", onOver);
    root.removeEventListener("pointerout", onOut);
  };
}

/** The masthead's entrance: the printed rules run out from the title, and the foil catches the light once. */
export function openMasthead(masthead: HTMLElement) {
  if (reducedMotion()) return;
  const rules = masthead.querySelectorAll<HTMLElement>(".mast__rule");
  const title = masthead.querySelector<HTMLElement>(".mast__title");
  animate(rules, { scaleX: [0, 1], duration: 900, delay: 120, ease: "outExpo" });
  if (title) animate(title, { backgroundPositionX: ["0%", "100%"], duration: 2200, delay: 200, ease: "inOutSine" });
}

/**
 * Shifts the gold foil of the title as the pointer crosses the page, the way foil lettering changes
 * when a card is tilted under a lamp.
 */
export function watchFoil(title: HTMLElement): () => void {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches || reducedMotion()) return () => {};
  let frame = 0;
  const onMove = (event: PointerEvent) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const across = (event.clientX / window.innerWidth) * 100;
      const down = (event.clientY / window.innerHeight) * 100;
      animate(title, { backgroundPositionX: `${across}%`, backgroundPositionY: `${down}%`, duration: 900, ease: "outExpo" });
    });
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  return () => {
    window.removeEventListener("pointermove", onMove);
    cancelAnimationFrame(frame);
  };
}
