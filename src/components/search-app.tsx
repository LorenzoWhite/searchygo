"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ATTRIBUTES, MD_RARITIES, MD_RARITY_NAMES, MONSTER_TYPES, type Card, type CardKind, type MasterDuelRarity } from "@/lib/card";
import { copiesOf, deckSize, homeSection, whyNot } from "@/lib/deck";
import { ROLES } from "@/lib/vocabulary";
import { centreOf, dealMat, kickDeck, openMasthead, sendToDeck, snapshotMat, stamp, watchFoil, watchPockets, type MatSnapshot } from "@/lib/motion";
import { useDeck } from "@/lib/use-deck";
import type { SearchResponse } from "@/lib/search-response";
import { CardRow } from "./card-row";
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
  literal: "",
  not: "",
};
/** The filters that belong to the search box rather than to the filter controls, and outlast "Clear filters". */
const SEARCH_OWNED = ["literal", "not"] as const satisfies readonly (keyof Filters)[];
const MAX_EXCLUSIONS = 8;

const exclusionsOf = (filters: Filters) => (filters.not ? filters.not.split("|") : []);
const MONSTER_ONLY: Partial<Filters> = { attribute: "", type: "", levelMin: "", levelMax: "" };
const ROLE_NAMES = Object.keys(ROLES).sort();
const EXAMPLES = ["revive a WATER monster", "hand traps that negate", "triggers when banished", "Swordsoul support", "synergy with Tearlaments"];
const KINDS: { value: Filters["kind"]; label: string }[] = [
  { value: "", label: "All" },
  { value: "monster", label: "Monsters" },
  { value: "spell", label: "Spells" },
  { value: "trap", label: "Traps" },
];
const LEVELS = Array.from({ length: 13 }, (_, i) => String(i + 1));
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
  /** On a phone the filters are folded away until asked for; a wider screen always shows them. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** Whether the box for adding an exclusion is showing, and what has been typed in it. */
  const [excluding, setExcluding] = useState(false);
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
  }, [data]);

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
  const clearFilters = () => setFilters((current) => ({ ...NO_FILTERS, literal: current.literal, not: current.not }));

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
  const filtersOn = [filters.kind, filters.role, filters.attribute, filters.type, filters.levelMin || filters.levelMax, filters.rarity, filters.genesysMin || filters.genesysMax].filter(Boolean).length;
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
              <label htmlFor="query">Effect, card name or keyword</label>
              <div className="query">
                <input
                  id="query"
                  ref={inputRef}
                  type="search"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="special summon a WATER monster from the GY"
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
                ) : text.trim() === "" ? (
                  <>
                    <span className="reading__label">Try</span>
                    <ul className="reading__examples">
                      {EXAMPLES.map((example) => (
                        <li key={example}>
                          <button type="button" className="button button--quiet" onClick={() => setText(example)}>
                            {example}
                          </button>
                        </li>
                      ))}
                    </ul>
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
                <button
                  type="button"
                  className="button button--quiet"
                  aria-expanded={excluding}
                  aria-controls="exclude-entry"
                  onClick={() => {
                    setExcluding((open) => !open);
                    // The box is focused once it is on the page, so typing can start straight away.
                    if (!excluding) requestAnimationFrame(() => excludeRef.current?.focus());
                  }}
                >
                  {excluding ? "Done" : exclusions.length ? "Exclude something else" : "Exclude cards"}
                </button>
                <div className="exclude__entry" id="exclude-entry" hidden={!excluding}>
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
              </div>
            </div>

            <button type="button" className="button filters__toggle" aria-expanded={filtersOpen} aria-controls="filters" onClick={() => setFiltersOpen((open) => !open)}>
              {filtersOpen ? "Hide filters" : "Filters"}
              {filtersOn > 0 && ` · ${filtersOn} on`}
            </button>

            <div className="filters" id="filters" data-open={filtersOpen}>
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
                {data.synergy && (
                <div className="synergy zone">
                  <p className="synergy__plan">
                    <strong>{data.synergy.archetype}</strong> {data.synergy.plan}
                  </p>
                  <p className="synergy__label">Looking for cards from outside it that are</p>
                  <ul className="synergy__hooks">
                    {data.synergy.hooks.map((hook) => (
                      <li key={hook.label}>
                        <strong>{hook.label}</strong> {hook.why}
                      </li>
                    ))}
                  </ul>
                  <p className="synergy__note">
                    A model worked this out from the archetype’s cards, so these are suggestions to check, not rulings.
                  </p>
                </div>
              )}

              <p className="results__count">
                  <span className="deck" ref={deckRef} aria-hidden="true" />
                  {data.total === 0 ? (
                    "No cards"
                  ) : (
                    <>
                      {!hasQuery && "All "}
                      <RollingNumber value={data.total} /> {data.total === 1 ? "card" : "cards"}
                      {!hasQuery && ", most viewed first"}
                    </>
                  )}
                  {reading && !reading.matched && data.total > 0 && (
                    <span className="results__note"> · no card fits that reading, so these match the words instead</span>
                  )}
                </p>

                {data.total === 0 ? (
                  <div className="notice">
                    <p>
                      <strong>No cards match{text.trim() ? ` “${text.trim()}”` : " these filters"}.</strong> Try fewer
                      words{hasFilters ? ", or clear the filters to search every card." : "."}
                    </p>
                    {hasFilters && (
                      <button type="button" className="button" onClick={clearFilters}>
                        Clear filters
                      </button>
                    )}
                  </div>
                ) : (
                  <ol className={`cards${status === "loading" ? " cards--stale" : ""}`} ref={listRef}>
                    {data.results.map((result) => (
                      <CardRow
                        key={result.card.id}
                        result={result}
                          slot={{
                          copies: copiesOf(deck.deck, result.card.id),
                          blocked: whyNot(deck.deck, result.card, homeSection(result.card)),
                          onAdd: addToDeck,
                          onRemove: (card) => deck.remove(card.id),
                        }}
                      />
                    ))}
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
      <DeckPanel controls={deck} open={deckOpen} onClose={closeDeck} landingRef={deckLandingRef} />
    </div>
  );
}
