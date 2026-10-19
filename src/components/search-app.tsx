"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { FEATURES } from "@/lib/features";
import { SORTS, SORT_DIRECTIONS, type SortBy, type SortDirection } from "@/lib/sort";
import { ATTRIBUTES, FORMATS, MD_RARITIES, MD_RARITY_NAMES, MONSTER_TYPES, type Card, type CardKind, type MasterDuelRarity } from "@/lib/card";
import { copiesOf, deckSize, homeSection, whyNot } from "@/lib/deck";
import { ROLES } from "@/lib/vocabulary";
import { centreOf, dealMat, kickDeck, openMasthead, sendToDeck, snapshotMat, stamp, watchFoil, watchPockets, type MatSnapshot } from "@/lib/motion";
import { useDeck } from "@/lib/use-deck";
import type { SearchResponse } from "@/lib/search-response";
import { CardRow, type DeckSlot } from "./card-row";
import { CardDialog, GalleryCard } from "./card-gallery";
import { DeckPanel } from "./deck-panel";
import { RollingNumber } from "./rolling-number";

interface Filters {
  kind: CardKind | "";
  role: string;
  attribute: string;
  type: string;
  levelMin: string;
  levelMax: string;
  /** Master Duel rarities, comma-separated; a card of any of them matches. */
  rarity: string;
  genesysMin: string;
  genesysMax: string;
  /** ATK and DEF ranges, as typed. */
  atkMin: string;
  atkMax: string;
  defMin: string;
  defMax: string;
  /** A TCG set the card was printed in, by code or name. */
  set: string;
  /** "main" or "extra": Main Deck cards or Extra Deck monsters. */
  deck: string;
  /** A format the card is legal in (see FORMATS). */
  format: string;
  /** First released in or between these years. */
  from: string;
  to: string;
  /** How results are ordered (see SORTS); "" is best match. */
  sort: string;
  /** "asc" or "desc"; "" is the order's natural direction. */
  dir: string;
  /** "1" matches the words against card text instead of reading them as an effect. */
  literal: string;
  /** What to exclude from the results, as searches of their own, separated by "|". */
  not: string;
}

const NO_FILTERS: Filters = {
  kind: "",
  role: "",
  attribute: "",
  type: "",
  levelMin: "",
  levelMax: "",
  rarity: "",
  genesysMin: "",
  genesysMax: "",
  atkMin: "",
  atkMax: "",
  defMin: "",
  defMax: "",
  set: "",
  deck: "",
  format: "",
  from: "",
  to: "",
  sort: "",
  dir: "",
  literal: "",
  not: "",
};
/**
 * What belongs to the search box or the results rather than to the filter controls: it outlasts
 * "Clear filters" and is not counted as a filter.
 */
const SEARCH_OWNED = ["literal", "not", "sort", "dir"] as const satisfies readonly (keyof Filters)[];

const SORT_LABELS: Record<SortBy, string> = {
  match: "Best match",
  name: "Name",
  atk: "ATK",
  def: "DEF",
  level: "Level, Rank or Link",
  date: "Release date",
  popular: "Most viewed",
};
/** Each direction said for what is being sorted. */
const directionLabel = (by: SortBy, dir: SortDirection) =>
  by === "name" ? (dir === "asc" ? "A → Z" : "Z → A") : by === "date" ? (dir === "asc" ? "Oldest first" : "Newest first") : dir === "asc" ? "Low → high" : "High → low";
const MAX_EXCLUSIONS = 8;
const VIEW_KEY = "searchygo:view";

const exclusionsOf = (filters: Filters) => (filters.not ? filters.not.split("|") : []);
const MONSTER_ONLY: Partial<Filters> = { attribute: "", type: "", levelMin: "", levelMax: "" };
const ROLE_NAMES = Object.keys(ROLES).sort();
/** Searches shown in turn inside the empty search box, as examples of what it understands. */
/** Short enough that each fits whole in the box on a narrow phone. */
const HINTS = [
  "revive a WATER monster",
  "hand traps that negate",
  "synergy with Branded",
  "triggers when banished",
  "Swordsoul support",
  "search a Level 4 Warrior",
  "Blue-Eyes White Dragon",
  "Spells with GY effects",
  "destroy Spells and Traps",
  "draw 2 cards",
];
const KINDS: { value: Filters["kind"]; label: string }[] = [
  { value: "", label: "All" },
  { value: "monster", label: "Monsters" },
  { value: "spell", label: "Spells" },
  { value: "trap", label: "Traps" },
];
const LEVELS = Array.from({ length: 13 }, (_, i) => String(i + 1));
/** From the first OCG cards (1999) to next year, for cards announced ahead of release. Newest first. */
const YEARS = Array.from({ length: new Date().getFullYear() + 2 - 1999 }, (_, i) => String(new Date().getFullYear() + 1 - i));
const year = (value: string | null) => (value && /^\d{4}$/.test(value) ? value : "");
const stat = (value: string | null) => (value && /^\d{1,5}$/.test(value) ? value : "");
const DEBOUNCE_MS = 160;
const SKELETON_ROWS = 6;

const count = new Intl.NumberFormat("en-US");

/** Genesys points run from 0 to the format's standard cap. */
const GENESYS_CAP = 100;

/** Reads a Genesys point bound from the URL, keeping it a whole number on that scale. */
const points = (value: string | null) => {
  const digits = (value ?? "").replace(/\D/g, "").slice(0, 3);
  return digits === "" ? "" : String(Math.min(Number(digits), GENESYS_CAP));
};

/** The Genesys filter in words, as shown above the slider and read out by a screen reader. */
function describeGenesys(atLeast: boolean, value: number): string {
  if (atLeast) return value === 0 ? "Any" : value === GENESYS_CAP ? `${value} only` : `${value} or more`;
  return value === GENESYS_CAP ? "Any" : value === 0 ? "0 only" : `${value} or less`;
}

function toParams(text: string, filters: Filters, page = 1): URLSearchParams {
  const params = new URLSearchParams();
  if (text.trim()) params.set("q", text.trim());
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  return params;
}

/**
 * The address a search is fetched from. The server ignores case and spacing, so those are evened out
 * and the parameters put in a fixed order: two people who type the same search differently then ask
 * for the same address, and the second gets the answer the first one cached.
 */
function searchAddress(params: URLSearchParams): string {
  const sent = new URLSearchParams(params);
  for (const name of ["q", "not"]) {
    const value = sent.get(name);
    if (value) sent.set(name, value.toLowerCase().replace(/\s+/g, " ").trim());
  }
  sent.sort();
  return `/api/search?${sent}`;
}

function fromParams(params: URLSearchParams): { text: string; filters: Filters } {
  const kind = params.get("kind");
  // The slider holds one bound at a time, so a link carrying both keeps the upper one.
  const genesysMax = points(params.get("genesysMax"));
  return {
    text: params.get("q") ?? "",
    filters: {
      kind: kind === "monster" || kind === "spell" || kind === "trap" ? kind : "",
      role: params.get("role") ?? "",
      attribute: params.get("attribute") ?? "",
      type: params.get("type") ?? "",
      levelMin: params.get("levelMin") ?? "",
      levelMax: params.get("levelMax") ?? "",
      rarity: MD_RARITIES.filter((rarity) => params.get("rarity")?.split(",").includes(rarity)).join(","),
      genesysMin: genesysMax ? "" : points(params.get("genesysMin")),
      genesysMax,
      atkMin: stat(params.get("atkMin")),
      atkMax: stat(params.get("atkMax")),
      defMin: stat(params.get("defMin")),
      defMax: stat(params.get("defMax")),
      set: (params.get("set") ?? "").slice(0, 80),
      deck: params.get("deck") === "main" || params.get("deck") === "extra" ? params.get("deck")! : "",
      format: FORMATS.find((format) => format === params.get("format")) ?? "",
      from: year(params.get("from")),
      to: year(params.get("to")),
      sort: SORTS.find((sort) => sort !== "match" && sort === params.get("sort")) ?? "",
      dir: params.get("dir") === "asc" || params.get("dir") === "desc" ? params.get("dir")! : "",
      literal: params.get("literal") === "1" ? "1" : "",
      not: (params.get("not") ?? "")
        .split("|")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, MAX_EXCLUSIONS)
        .join("|"),
    },
  };
}

export function SearchApp() {
  const [text, setText] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // The URL holds the search so it can be shared; it is only readable after mount.
  const [restored, setRestored] = useState(false);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /** Which way the Genesys slider reads: "this many or more" rather than "or less". */
  const [genesysAtLeast, setGenesysAtLeast] = useState(false);
  /**
   * How results are laid out: full tiles to read, or a gallery of pictures to scan, where tapping one
   * opens it. Phones start on the gallery, wider screens on the list; a choice is remembered.
   */
  const [view, setView] = useState<"list" | "gallery">("list");
  const [opened, setOpened] = useState<number | null>(null);
  /** A card opened from the deck, with the rest of its section to step through. */
  const [deckOpened, setDeckOpened] = useState<{ ids: number[]; index: number } | null>(null);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(VIEW_KEY);
    } catch {
      // Without storage the choice simply lasts for this visit.
    }
    setView(saved === "list" || saved === "gallery" ? saved : window.matchMedia("(max-width: 40rem)").matches ? "gallery" : "list");
  }, []);
  const chooseView = (next: "list" | "gallery") => {
    beforeRef.current = snapshotMat(null);
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // as above
    }
  };
  /** On a phone the filters are folded away until asked for; a wider screen always shows them. */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** TCG sets for the set filter's suggestions, fetched the first time the advanced search opens. */
  const [setNames, setSetNames] = useState<{ name: string; code: string }[]>([]);
  const [hint, setHint] = useState(0);
  /** Whether the box for adding an exclusion is showing, and what has been typed in it. */
  const [unwanted, setUnwanted] = useState("");
  const excludeRef = useRef<HTMLInputElement>(null);
  const excludedRef = useRef<HTMLUListElement>(null);
  const deck = useDeck();
  const [deckOpen, setDeckOpen] = useState(false);
  const deckButtonRef = useRef<HTMLButtonElement>(null);
  /** Where a card sent to the deck lands while the panel is open and the button is out of sight. */
  const deckLandingRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mastRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const deckRef = useRef<HTMLSpanElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const graveyardRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLUListElement>(null);
  /** Where the cards were just before the results changed, and where the new ones are dealt from. */
  const beforeRef = useRef<MatSnapshot | null>(null);
  const dealFromRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const initial = fromParams(new URLSearchParams(window.location.search));
    setText(initial.text);
    setFilters(initial.filters);
    setGenesysAtLeast(initial.filters.genesysMin !== "");
    // A shared link with filters set opens the advanced search, so what narrows the results is in view.
    const owned: readonly string[] = SEARCH_OWNED;
    if (Object.entries(initial.filters).some(([name, value]) => value && (!owned.includes(name) || name === "not"))) setAdvancedOpen(true);
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");
      const params = toParams(text, filters);
      window.history.replaceState(null, "", params.size ? `?${params}` : window.location.pathname);
      try {
        const response = await fetch(searchAddress(params), { signal: controller.signal });
        if (!response.ok) throw new Error(`Search responded ${response.status}`);
        const next = (await response.json()) as SearchResponse;
        beforeRef.current = snapshotMat(listRef.current);
        dealFromRef.current = null;
        setData(next);
        setStatus("ready");
      } catch (error) {
        if (!controller.signal.aborted) setStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, filters, restored, attempt]);

  // "/" jumps to the search box, as on most search-first sites.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const loadMore = useCallback(async () => {
    if (!data) return;
    setLoadingMore(true);
    try {
      const response = await fetch(searchAddress(toParams(text, filters, data.page + 1)));
      if (!response.ok) throw new Error(`Search responded ${response.status}`);
      const next = (await response.json()) as SearchResponse;
      // These cards are drawn from the button that was pressed, not from the deck at the top.
      beforeRef.current = snapshotMat(listRef.current);
      dealFromRef.current = moreRef.current ? centreOf(moreRef.current) : null;
      setData({ ...next, results: [...data.results, ...next.results] });
    } catch {
      setStatus("error");
    } finally {
      setLoadingMore(false);
    }
  }, [data, text, filters]);

  // Whenever the results change, play the change: cards slide, leave, and are dealt in.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !data) return;
    const before = beforeRef.current ?? snapshotMat(null);
    beforeRef.current = null;
    const deck = dealFromRef.current ?? (deckRef.current ? centreOf(deckRef.current) : { x: 0, y: 0 });
    dealMat(list, before, deck, graveyardRef.current);
    kickDeck(deckRef.current);
  }, [data, view]);

  const chips = data?.reading?.chips.join("|") ?? "";
  useLayoutEffect(() => {
    if (chipsRef.current) stamp(chipsRef.current.querySelectorAll("li"));
  }, [chips]);

  // A new exclusion is stamped onto the mat like the reading is; the ones already there stay put.
  const stampedExclusions = useRef(0);
  const exclusionCount = filters.not ? filters.not.split("|").length : 0;
  useLayoutEffect(() => {
    const added = [...(excludedRef.current?.querySelectorAll<HTMLElement>("li") ?? [])].slice(stampedExclusions.current);
    if (restored && added.length) stamp(added);
    stampedExclusions.current = exclusionCount;
  }, [exclusionCount, restored]);

  useEffect(() => {
    const masthead = mastRef.current;
    const title = masthead?.querySelector<HTMLElement>(".mast__title");
    if (!masthead || !title) return;
    openMasthead(masthead);
    return watchFoil(title);
  }, []);

  useEffect(() => (resultsRef.current ? watchPockets(resultsRef.current) : undefined), []);

  const setFilter = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const setKind = (kind: Filters["kind"]) =>
    // Attribute, Type and Level only exist on monsters, so they are dropped for Spells and Traps.
    setFilters((current) => (kind === "spell" || kind === "trap" ? { ...current, ...MONSTER_ONLY, kind } : { ...current, kind }));
  const clearFilters = () =>
    setFilters((current) => ({ ...NO_FILTERS, ...Object.fromEntries(SEARCH_OWNED.map((name) => [name, current[name]])) }));

  const exclusions = exclusionsOf(filters);
  const exclude = (entry: string) => {
    // "|" separates the entries in the address, so it cannot be part of one.
    const wanted = entry.replaceAll("|", " ").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!wanted || exclusions.length >= MAX_EXCLUSIONS || exclusions.some((existing) => existing.toLowerCase() === wanted.toLowerCase())) return;
    setFilter({ not: [...exclusions, wanted].join("|") });
  };
  const include = (entry: string) => setFilter({ not: exclusions.filter((existing) => existing !== entry).join("|") });
  // The ends of the slider that take in every card ("100 or less", "0 or more") mean no filter at all.
  const genesysValue = genesysAtLeast ? Number(filters.genesysMin || 0) : Number(filters.genesysMax || GENESYS_CAP);
  const setGenesys = (atLeast: boolean, value: number) => {
    setGenesysAtLeast(atLeast);
    setFilter(
      atLeast
        ? { genesysMin: value > 0 ? String(value) : "", genesysMax: "" }
        : { genesysMin: "", genesysMax: value < GENESYS_CAP ? String(value) : "" },
    );
  };
  const rarities = filters.rarity ? filters.rarity.split(",") : [];
  const toggleRarity = (toggled: MasterDuelRarity) =>
    setFilter({ rarity: MD_RARITIES.filter((rarity) => (rarity === toggled) !== rarities.includes(rarity)).join(",") });

  // Built from what the deck knows, so a card taken out of the deck while open stays readable.
  const deckResults = (deckOpened?.ids ?? []).flatMap((id) => {
    const card = deck.cards.get(id);
    const notes = deck.notes.get(id);
    return card ? [{ card, summary: notes?.summary, roles: notes?.roles ?? [] }] : [];
  });
  /** Swaps the results for the cards related to one card, as a search anyone can share or edit. */
  const showRelated = (card: Card) => {
    setText(`related to ${card.name}`);
    setFilter({ literal: "" });
    setOpened(null);
    setDeckOpened(null);
    setDeckOpen(false);
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const slotFor = (card: Card): DeckSlot => ({
    copies: copiesOf(deck.deck, card.id),
    blocked: whyNot(deck.deck, card, homeSection(card)),
    onAdd: addToDeck,
    onRemove: (removed) => deck.remove(removed.id),
  });
  const addToDeck = (card: Card, art: HTMLElement | null) => {
    if (deck.add(card)) return;
    const landing = deckOpen ? deckLandingRef.current : deckButtonRef.current;
    if (art && landing) sendToDeck(art, landing);
  };
  const closeDeck = () => {
    setDeckOpen(false);
    // The button comes back into view as the panel leaves, and takes the keyboard with it.
    requestAnimationFrame(() => deckButtonRef.current?.focus());
  };
  const inDeck = deckSize(deck.deck);

  const monsterFilters = filters.kind !== "spell" && filters.kind !== "trap";
  const hasFilters = Object.entries(filters).some(([name, value]) => !(SEARCH_OWNED as readonly string[]).includes(name) && value);
  const hasQuery = hasFilters || exclusions.length > 0 || text.trim() !== "";
  // Counted as a person would count them: a Level range or a Genesys bound is one filter, not two.
  const filtersOn = [filters.kind, filters.role, filters.attribute, filters.type, filters.levelMin || filters.levelMax, filters.rarity, filters.genesysMin || filters.genesysMax, filters.format, filters.from || filters.to, filters.atkMin || filters.atkMax, filters.defMin || filters.defMax, filters.set, filters.deck].filter(Boolean).length;
  const remaining = data ? data.total - data.results.length : 0;
  const reading = status === "error" ? undefined : data?.reading;

  return (
    <div className="shell" data-deck={deckOpen ? "open" : "closed"}>
      <div className="page">
        <header className="mast" ref={mastRef}>
          <a className="mast__name" href="/">
            <span className="mast__rule" aria-hidden="true" />
            <span className="mast__title">Search YGO</span>
            <span className="mast__rule" aria-hidden="true" />
          </a>
          <h1 className="mast__line">Search Yu-Gi-Oh! cards by what they do</h1>
        </header>

        <main className="main">
          <form className="search zone" role="search" onSubmit={(event) => event.preventDefault()}>
            <div className="field field--query">
              <label htmlFor="query" className="visually-hidden">
                Search cards by effect, card name or keyword
              </label>
              <div className="query">
                {text === "" && (
                  // The examples take turns in the empty box: each fades in, holds, and fades out, and the
                  // end of each round of the animation moves to the next one.
                  <span className="query__placeholder" aria-hidden="true" onAnimationIteration={() => setHint((shown) => (shown + 1) % HINTS.length)}>
                    {HINTS[hint]}
                  </span>
                )}
                <input
                  id="query"
                  ref={inputRef}
                  type="search"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={200}
                />
                <kbd className="query__hint" aria-hidden="true">
                  /
                </kbd>
              </div>
              <div className="reading" aria-live="polite">
                {reading ? (
                  <>
                    <span className="reading__label">Read as</span>
                    <ul className="reading__chips" ref={chipsRef}>
                      {reading.chips.map((chip) => (
                        <li key={chip}>{chip}</li>
                      ))}
                    </ul>
                    <button type="button" className="button button--quiet" onClick={() => setFilter({ literal: "1" })}>
                      Match the words instead
                    </button>
                  </>
                ) : filters.literal ? (
                  <>
                    <span className="reading__label">Matching the words in card text</span>
                    <button type="button" className="button button--quiet" onClick={() => setFilter({ literal: "" })}>
                      Read as an effect
                    </button>
                  </>
                ) : null}
              </div>

              <div className="exclude" role="group" aria-label="Excluded cards">
                {exclusions.length > 0 && (
                  <>
                    <span className="reading__label">Excluding</span>
                    <ul className="exclude__list" ref={excludedRef}>
                      {exclusions.map((entry) => {
                        // Shown as the search read it, once the search has; until then, as it was typed.
                        const read = status === "error" ? undefined : data?.excluded?.find((excluded) => excluded.text === entry.toLowerCase());
                        return (
                          <li key={entry} title={`Excluding: ${entry}`}>
                            <span>{read ? read.chips.join(" · ") : entry}</span>
                            <button type="button" aria-label={`Stop excluding ${entry}`} onClick={() => include(entry)}>
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            </div>

            {/* Everything beyond the search box waits behind one toggle, so the box stays the first thing you see. */}
            <div className="search__tools">
              <button
                type="button"
                className="button advanced__toggle"
                aria-expanded={advancedOpen}
                aria-controls="advanced"
                onClick={() => {
                  setAdvancedOpen((open) => !open);
                  if (!setNames.length) {
                    fetch("/api/sets")
                      .then((response) => (response.ok ? response.json() : { sets: [] }))
                      .then((body: { sets: { name: string; code: string }[] }) => setSetNames(body.sets))
                      .catch(() => {});
                  }
                }}
              >
                {advancedOpen ? "Hide advanced search" : "Advanced search"}
                {filtersOn + exclusions.length > 0 && ` · ${filtersOn + exclusions.length} on`}
              </button>
            </div>

            <div className="advanced" id="advanced" hidden={!advancedOpen}>
              <div className="exclude__entry" role="group" aria-label="Exclude cards">
                <label htmlFor="unwanted">Exclude cards that match</label>
                <div className="exclude__row">
                  <input
                    id="unwanted"
                    ref={excludeRef}
                    type="text"
                    value={unwanted}
                    placeholder="Link monsters, banish from the GY, Swordsoul…"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={100}
                    disabled={exclusions.length >= MAX_EXCLUSIONS}
                    onChange={(event) => setUnwanted(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      // Enter adds the entry; it must not also submit the search form around it.
                      event.preventDefault();
                      exclude(unwanted);
                      setUnwanted("");
                    }}
                  />
                  <button
                    type="button"
                    className="button"
                    disabled={unwanted.trim() === "" || exclusions.length >= MAX_EXCLUSIONS}
                    onClick={() => {
                      exclude(unwanted);
                      setUnwanted("");
                      excludeRef.current?.focus();
                    }}
                  >
                    Exclude
                  </button>
                </div>
                <p className="exclude__note">
                  {exclusions.length >= MAX_EXCLUSIONS
                    ? `That is the most a search can exclude (${MAX_EXCLUSIONS}). Remove one to add another.`
                    : "Written like a search: whatever it would find is taken out of the results."}
                </p>
              </div>

            <div className="filters">
              <fieldset className="field">
                <legend>Card type</legend>
                <div className="segments segments--kind">
                  {KINDS.map(({ value, label }) => (
                    <button
                      key={label}
                      type="button"
                      className="segment"
                      aria-pressed={filters.kind === value}
                      onClick={() => setKind(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="field">
                <legend>Deck</legend>
                <div className="segments segments--deck">
                  {(
                    [
                      ["", "Any"],
                      ["main", "Main Deck"],
                      ["extra", "Extra Deck"],
                    ] as const
                  ).map(([value, label]) => (
                    <button key={label} type="button" className="segment" aria-pressed={filters.deck === value} onClick={() => setFilter({ deck: value })}>
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="field">
                <label htmlFor="role">Role</label>
                <select id="role" value={filters.role} onChange={(event) => setFilter({ role: event.target.value })}>
                  <option value="">Any</option>
                  {ROLE_NAMES.map((role) => (
                    <option key={role} value={role} title={ROLES[role as keyof typeof ROLES]}>
                      {role[0]!.toUpperCase() + role.slice(1).replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>

              {monsterFilters && (
                <>
                  <div className="field">
                    <label htmlFor="attribute">Attribute</label>
                    <select id="attribute" value={filters.attribute} onChange={(event) => setFilter({ attribute: event.target.value })}>
                      <option value="">Any</option>
                      {ATTRIBUTES.map((attribute) => (
                        <option key={attribute}>{attribute}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="type">Monster Type</label>
                    <select id="type" value={filters.type} onChange={(event) => setFilter({ type: event.target.value })}>
                      <option value="">Any</option>
                      {MONSTER_TYPES.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <fieldset className="field field--half">
                <legend>
                  Master Duel<span className="visually-hidden"> rarity</span>
                </legend>
                <div className="segments segments--rarity">
                  {MD_RARITIES.map((rarity) => (
                    <button
                      key={rarity}
                      type="button"
                      className={`segment rarity--${rarity.toLowerCase()}`}
                      aria-pressed={rarities.includes(rarity)}
                      title={MD_RARITY_NAMES[rarity]}
                      onClick={() => toggleRarity(rarity)}
                    >
                      {rarity}
                      <span className="visually-hidden"> ({MD_RARITY_NAMES[rarity]})</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              {monsterFilters && (
                <fieldset className="field">
                  <legend>Level, Rank or Link</legend>
                  <div className="range">
                    <select aria-label="Lowest level" value={filters.levelMin} onChange={(event) => setFilter({ levelMin: event.target.value })}>
                      <option value="">Min</option>
                      {LEVELS.map((level) => (
                        <option key={level}>{level}</option>
                      ))}
                    </select>
                    <span aria-hidden="true">–</span>
                    <select aria-label="Highest level" value={filters.levelMax} onChange={(event) => setFilter({ levelMax: event.target.value })}>
                      <option value="">Max</option>
                      {LEVELS.map((level) => (
                        <option key={level}>{level}</option>
                      ))}
                    </select>
                  </div>
                </fieldset>
              )}

              {monsterFilters &&
                (["atk", "def"] as const).map((stat) => (
                  <fieldset className="field" key={stat}>
                    <legend>{stat.toUpperCase()}</legend>
                    <div className="range">
                      {(["Min", "Max"] as const).map((end, at) => {
                        const key = `${stat}${end}` as "atkMin" | "atkMax" | "defMin" | "defMax";
                        return (
                          <Fragment key={end}>
                            {at === 1 && <span aria-hidden="true">–</span>}
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={10000}
                              step={50}
                              placeholder={end}
                              aria-label={`${end === "Min" ? "Lowest" : "Highest"} ${stat.toUpperCase()}`}
                              value={filters[key]}
                              onChange={(event) => setFilter({ [key]: event.target.value.replace(/\D/g, "").slice(0, 5) })}
                            />
                          </Fragment>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}

              <div className="field">
                <label htmlFor="format">Format</label>
                <select id="format" value={filters.format} onChange={(event) => setFilter({ format: event.target.value })}>
                  <option value="">Any</option>
                  {FORMATS.map((format) => (
                    <option key={format}>{format}</option>
                  ))}
                </select>
              </div>

              <fieldset className="field">
                <legend title="The year the card first came out: in the OCG for an OCG format, otherwise in the TCG">
                  Released{filters.format.startsWith("OCG") ? " (OCG)" : ""}
                </legend>
                <div className="range">
                  <select aria-label="Released from" value={filters.from} onChange={(event) => setFilter({ from: event.target.value })}>
                    <option value="">From</option>
                    {YEARS.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                  <span aria-hidden="true">–</span>
                  <select aria-label="Released up to" value={filters.to} onChange={(event) => setFilter({ to: event.target.value })}>
                    <option value="">To</option>
                    {YEARS.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </div>
              </fieldset>

              <div className="field field--set">
                <label htmlFor="set">TCG set</label>
                <input
                  id="set"
                  type="text"
                  list="set-names"
                  placeholder="Name or code, e.g. RA04"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={80}
                  value={filters.set}
                  onChange={(event) => setFilter({ set: event.target.value })}
                />
                <datalist id="set-names">
                  {setNames.map(({ name, code }) => (
                    <option key={name} value={name}>
                      {code}
                    </option>
                  ))}
                </datalist>
              </div>

              <div className="field field--wide" role="group" aria-labelledby="genesys-label">
                <div className="field__head">
                  <span className="field__label" id="genesys-label">
                    Genesys points
                  </span>
                  <output className="field__value" htmlFor="genesys">
                    {describeGenesys(genesysAtLeast, genesysValue)}
                  </output>
                </div>
                <div className="slider">
                  <div className="segments segments--compare">
                    <button
                      type="button"
                      className="segment"
                      aria-pressed={!genesysAtLeast}
                      title="This many points or less"
                      onClick={() => setGenesys(false, genesysValue)}
                    >
                      ≤<span className="visually-hidden"> (or less)</span>
                    </button>
                    <button
                      type="button"
                      className="segment"
                      aria-pressed={genesysAtLeast}
                      title="This many points or more"
                      onClick={() => setGenesys(true, genesysValue)}
                    >
                      ≥<span className="visually-hidden"> (or more)</span>
                    </button>
                  </div>
                  <input
                    id="genesys"
                    className="slider__range"
                    type="range"
                    min={0}
                    max={GENESYS_CAP}
                    step={1}
                    value={genesysValue}
                    aria-labelledby="genesys-label"
                    aria-valuetext={describeGenesys(genesysAtLeast, genesysValue)}
                    data-reads={genesysAtLeast ? "up" : "down"}
                    style={{ "--at": genesysValue / GENESYS_CAP } as CSSProperties}
                    onChange={(event) => setGenesys(genesysAtLeast, Number(event.target.value))}
                  />
                </div>
              </div>

              {hasFilters && (
                <button type="button" className="button button--quiet" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
            </div>
          </form>

          <section className="results" ref={resultsRef} aria-busy={status === "loading"} aria-live="polite">
            {/* Cards that no longer match are shown falling away here. */}
            <div className="graveyard" ref={graveyardRef} aria-hidden="true" />
            {status === "error" ? (
              <div className="notice notice--error" role="alert">
                <p>
                  <strong>The search didn’t load.</strong> The server returned an error or could not be reached.
                </p>
                <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
                  Retry search
                </button>
              </div>
            ) : !data ? (
              // Empty card zones hold the layout while the first results load.
              <ol className="cards" aria-hidden="true">
                {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                  <li key={i} className="tile tile--empty" />
                ))}
              </ol>
            ) : (
              <>
                {data.counters && (
                  <div className="synergy zone">
                    <p className="synergy__plan">
                      <strong>{data.counters.archetype}</strong> {data.counters.plan}
                    </p>
                    {(["going_first", "going_second", "either"] as const).map((when) => {
                      const weaknesses = data.counters!.weaknesses.filter((weakness) => weakness.when === when);
                      if (!weaknesses.length) return null;
                      return (
                        <Fragment key={when}>
                          <p className="synergy__label">
                            {when === "going_first" ? "Going first, stop it while it plays:" : when === "going_second" ? "Going second, break what it ends on:" : "Either way:"}
                          </p>
                          <ul className="synergy__hooks">
                            {weaknesses.map((weakness) => (
                              <li key={weakness.label}>
                                <strong>{weakness.label}</strong> {weakness.why}
                              </li>
                            ))}
                          </ul>
                        </Fragment>
                      );
                    })}
                    <p className="synergy__note">
                      {data.counters.with ? `Only cards that also work with ${data.counters.with} are shown. ` : "The answers players side against it come first. "}
                      A model worked this out from the archetype’s cards, so these are suggestions to check, not rulings.
                    </p>
                  </div>
                )}

                {data.synergy && (
                <div className="synergy zone">
                  {[data.synergy, ...(data.synergy.partner ? [data.synergy.partner] : [])].map((deck) => (
                    <Fragment key={deck.archetype}>
                      <p className="synergy__plan">
                        <strong>{deck.archetype}</strong> {deck.plan}
                      </p>
                      <p className="synergy__label">Looking for cards from outside it that are</p>
                      <ul className="synergy__hooks">
                        {deck.hooks.map((hook) => (
                          <li key={hook.label}>
                            <strong>{hook.label}</strong> {hook.why}
                          </li>
                        ))}
                      </ul>
                    </Fragment>
                  ))}
                  {data.synergy.partner && (
                    <p className="synergy__note">
                      Cards that work with both: first the {data.synergy.archetype} cards that fit {data.synergy.partner.archetype} and the{" "}
                      {data.synergy.partner.archetype} cards that fit {data.synergy.archetype}, then outside cards that fit both.
                    </p>
                  )}
                  <p className="synergy__note">
                    A model worked this out from the archetype’s cards, so these are suggestions to check, not rulings.
                  </p>
                </div>
              )}

              <div className="results__bar">
              <p className="results__count">
                  <span className="deck" ref={deckRef} aria-hidden="true" />
                  {data.total === 0 ? (
                    "No cards"
                  ) : (
                    <>
                      {!hasQuery && "All "}
                      <RollingNumber value={data.total} /> {data.total === 1 ? "card" : "cards"}
                      {!hasQuery && !filters.sort && ", most viewed first"}
                    </>
                  )}
                  {reading && !reading.matched && data.total > 0 && (
                    <span className="results__note"> · no card fits that reading, so these match the words instead</span>
                  )}
                </p>
                {data.total > 1 && (
                  <div className="sorter">
                    <label htmlFor="sort">Sort</label>
                    <select id="sort" value={filters.sort || "match"} onChange={(event) => setFilter({ sort: event.target.value === "match" ? "" : event.target.value, dir: "" })}>
                      {SORTS.map((sort) => (
                        <option key={sort} value={sort}>
                          {SORT_LABELS[sort]}
                        </option>
                      ))}
                    </select>
                    {filters.sort && (() => {
                      const by = filters.sort as SortBy;
                      const dir = (filters.dir || SORT_DIRECTIONS[by]) as SortDirection;
                      const other: SortDirection = dir === "asc" ? "desc" : "asc";
                      return (
                        <button
                          type="button"
                          className="button sorter__dir"
                          aria-label={`Order: ${directionLabel(by, dir)}. Switch to ${directionLabel(by, other)}`}
                          onClick={() => setFilter({ dir: other === SORT_DIRECTIONS[by] ? "" : other })}
                        >
                          {directionLabel(by, dir)}
                        </button>
                      );
                    })()}
                  </div>
                )}
                {data.total > 0 && (
                  <div className="segments segments--view" role="group" aria-label="Show results as">
                    <button type="button" className="segment" aria-pressed={view === "gallery"} onClick={() => chooseView("gallery")}>
                      Gallery
                    </button>
                    <button type="button" className="segment" aria-pressed={view === "list"} onClick={() => chooseView("list")}>
                      List
                    </button>
                  </div>
                )}
              </div>

                {data.total === 0 ? (
                  <div className="notice">
                    {reading?.chips[0]?.startsWith("Related to: ") && !hasFilters ? (
                      <p>
                        <strong>No related cards yet.</strong> {reading.chips[0].slice("Related to: ".length)} belongs to no archetype and no
                        other card names it. Finding cards with similar effects is planned.
                      </p>
                    ) : (
                      <p>
                        <strong>No cards match{text.trim() ? ` “${text.trim()}”` : " these filters"}.</strong> Try fewer
                        words{hasFilters ? ", or clear the filters to search every card." : "."}
                      </p>
                    )}
                    {hasFilters && (
                      <button type="button" className="button" onClick={clearFilters}>
                        Clear filters
                      </button>
                    )}
                  </div>
                ) : (
                  <ol className={`cards${view === "gallery" ? " cards--gallery" : ""}${status === "loading" ? " cards--stale" : ""}`} ref={listRef}>
                    {data.results.map((result, index) =>
                      view === "gallery" ? (
                        <GalleryCard key={result.card.id} result={result} copies={copiesOf(deck.deck, result.card.id)} onOpen={() => setOpened(index)} />
                      ) : (
                        <CardRow key={result.card.id} result={result} slot={slotFor(result.card)} onRelated={FEATURES.related ? showRelated : undefined} />
                      ),
                    )}
                  </ol>
                )}

                {remaining > 0 && (
                  <button type="button" className="button button--more" ref={moreRef} onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}>
                    <span className="deck" aria-hidden="true" />
                    {loadingMore ? "Drawing…" : `Draw ${Math.min(remaining, data.pageSize)} more`}
                  </button>
                )}
              </>
            )}
          </section>
        </main>

        <footer className="foot">
          <p>
            Card data and images from{" "}
            <a href="https://ygoprodeck.com/" target="_blank" rel="noreferrer">
              YGOPRODeck
            </a>
            . Summaries are machine-written and can be wrong; the card text is the exact wording. An unofficial fan
            project, not affiliated with or endorsed by Konami. Card text and artwork belong to their owners.
          </p>
          <p>
            <a href="/credits">Credits</a>: the people who found bugs and suggested changes.
          </p>
        </footer>
      </div>

      <button
        type="button"
        className="deckbutton"
        ref={deckButtonRef}
        aria-expanded={deckOpen}
        aria-controls="deck"
        hidden={deckOpen}
        onClick={() => setDeckOpen(true)}
      >
        <span className="deck" aria-hidden="true" />
        Deck
        <span className="deckbutton__count">
          <RollingNumber value={inDeck} />
          <span className="visually-hidden"> {inDeck === 1 ? "card" : "cards"}</span>
        </span>
      </button>
      {/* On a screen too narrow to hold both, the panel lies over the search and this dims what is behind it. */}
      <div className="scrim" aria-hidden="true" onClick={closeDeck} />
      <CardDialog results={data?.results ?? []} index={opened} slotFor={slotFor} onMove={setOpened} onClose={() => setOpened(null)} onRelated={FEATURES.related ? showRelated : undefined} />
      <CardDialog
        results={deckResults}
        index={deckOpened && deckOpened.index < deckResults.length ? deckOpened.index : null}
        slotFor={slotFor}
        onMove={(index) => setDeckOpened((shown) => shown && { ...shown, index })}
        onClose={() => setDeckOpened(null)}
        onRelated={FEATURES.related ? showRelated : undefined}
      />
      <DeckPanel controls={deck} open={deckOpen} onClose={closeDeck} landingRef={deckLandingRef} onOpenCard={(cards, index) => setDeckOpened({ ids: cards.map((card) => card.id), index })} />
    </div>
  );
}
