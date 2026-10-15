/**
 * In-memory search over every card.
 *
 * A search is first read as an effect query (see query.ts) and answered from the card tags. When
 * the words say nothing the tags can answer, or nothing matches, it falls back to BM25 relevance
 * over card names, text and tag summaries.
 */
import type { Attribute, Card, CardKind, MasterDuelRarity, Subtype } from "./card.ts";
import { matchCard } from "./effect-match.ts";
import { buildArchetypeMatcher, interpret, type EffectQuery } from "./query.ts";
import { findPartners, type ArchetypeProfile } from "./synergy.ts";
import type { CardTags } from "./tags.ts";
import { tokenize } from "./text.ts";

export interface SearchQuery {
  text?: string;
  /** Skip the effect reading and match the words against card text only. */
  literal?: boolean;
  kinds?: CardKind[];
  attributes?: Attribute[];
  monsterTypes?: string[];
  subtypes?: Subtype[];
  roles?: CardTags["roles"];
  levelMin?: number;
  levelMax?: number;
  format?: string;
  mdRarities?: MasterDuelRarity[];
  /** Either bound also limits the search to cards that can be played in Genesys. */
  genesysMin?: number;
  genesysMax?: number;
  /** Searches whose results are to be left out of this one's. */
  exclude?: string[];
  offset?: number;
  limit?: number;
}

export interface SearchHit {
  card: Card;
  tags?: CardTags;
  score: number;
  /** In a synergy search: the reasons this card fits the archetype, as the profile names them. */
  fits?: string[];
}

/** What a synergy search was looking for, so the results can be explained. */
export interface SynergyReading {
  archetype: string;
  plan: string;
  hooks: { label: string; why: string; matches: number }[];
}

export interface SearchResult {
  total: number;
  hits: SearchHit[];
  /** How the search was read, when it was read as an effect query. */
  reading?: {
    chips: string[];
    /** False when no card fit the reading and the results are text matches instead. */
    matched: boolean;
  };
  synergy?: SynergyReading;
  /** How each exclusion was read, in the order given. One that could not be read is not listed. */
  excluded?: { text: string; chips: string[] }[];
}

/** A card kind named on its own ("traps", "spell cards"), which as an exclusion means cards of that kind. */
const KIND_ALONE = /^(?:all )?(monster|spell|trap)s?(?: cards?)?$/;

/**
 * The ways people ask what goes with a deck. Each captures what follows, or what comes before, as
 * the deck's name: "synergy with X", "works well with X", "good in X", "partners for X",
 * "X synergy", "X synergistic cards".
 */
const SYNERGY_PATTERNS = [
  /^(?:cards? )?(?:that |which )?(?:are |is )?(?:has |have |having |with )?(?:good |great |the best |best )?synerg(?:y|ies|ises?|izes?|istic) (?:with|for) (.+)$/,
  /^(?:cards? )?(?:that |which )?(?:works?|goes|go|pairs?|combos?|fits?|plays?) (?:well |good |best |nicely )?(?:with|in|into) (.+)$/,
  /^(?:good|great|best)(?: cards?)? (?:with|in|for) (.+)$/,
  /^(?:partners?|tech|splash(?:able)?(?: cards?)?) for (.+)$/,
  /^(.+?) (?:synerg(?:y|ies|istic)|partners?)(?: cards?| picks?| options?)?$/,
];
/** How a question is opened before it gets to the point: "what works with...", "show me cards that...". */
const QUESTION_OPENING = /^(?:what|which|show me|find|list|give me|any|are there(?: any)?)(?: is| are)?(?: the| some)? /;

interface Entry {
  card: Card;
  tags?: CardTags;
  /** term -> weighted frequency */
  terms: Map<string, number>;
  length: number;
  nameTerms: string[];
}

interface Scored {
  entry: Entry;
  score: number;
}

// How much a term counts depending on where it appears. Names get no extra weight here, otherwise a
// descriptive query like "water monster" ranks cards that merely have "Water" in their name.
const NAME_WEIGHT = 1;
const TAG_WEIGHT = 2;
const TEXT_WEIGHT = 1;
/**
 * Added when every query word is in the card's name, i.e. the user is looking a card up by name.
 * Large enough to put those cards first; among them the most popular wins, and an exact name beats all.
 */
const NAME_MATCH_SCORE = 1000;

/** Queries with at least this many words may leave one of them unmatched. */
const LONG_QUERY_TERMS = 5;
/** An archetype has to appear on this many cards before a bare word in a search is read as its name. */
const MIN_ARCHETYPE_CARDS = 3;

const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** A card's summary and roles, as shown on its tile. */
export interface CardNotes {
  summary?: string;
  roles: CardTags["roles"];
}

export class SearchIndex {
  private entries: Entry[] = [];
  /** Every passcode a card answers to, its alternate artworks included. */
  private byId = new Map<number, Card>();
  private tagsByCard = new Map<number, CardTags>();
  private postings = new Map<string, number[]>();
  private averageLength = 0;
  private findArchetypes: ReturnType<typeof buildArchetypeMatcher>;
  /** Archetype profiles by lower-cased name, and the partners each one finds, worked out on first use. */
  private profiles = new Map<string, { archetype: string; profile: ArchetypeProfile }>();
  private partners = new Map<string, ReturnType<typeof findPartners>>();
  readonly taggedCount: number;

  constructor(cards: Card[], tagsById: Map<number, CardTags>, profiles: ReadonlyMap<string, ArchetypeProfile> = new Map()) {
    for (const [archetype, profile] of profiles) this.profiles.set(archetype.toLowerCase(), { archetype, profile });
    let totalLength = 0;
    const archetypeCards = new Map<string, number>();
    for (const card of cards) {
      for (const id of [card.id, ...(card.aliases ?? [])]) this.byId.set(id, card);
      const tags = tagsById.get(card.id);
      if (tags) this.tagsByCard.set(card.id, tags);
      const terms = new Map<string, number>();
      const add = (text: string, weight: number) => {
        for (const term of tokenize(text)) terms.set(term, (terms.get(term) ?? 0) + weight);
      };

      const nameTerms = tokenize(card.name);
      add(card.name, NAME_WEIGHT);
      add(`${card.typeLine} ${card.monsterType ?? ""} ${card.attribute ?? ""} ${card.archetype ?? ""}`, TEXT_WEIGHT);
      add(card.text, TEXT_WEIGHT);
      if (card.pendulumText) add(card.pendulumText, TEXT_WEIGHT);
      if (tags) add(`${tags.summary} ${tags.keywords.join(" ")} ${tags.roles.join(" ").replaceAll("_", " ")}`, TAG_WEIGHT);
      for (const archetype of new Set([card.archetype, ...(tags?.supports.archetypes ?? [])])) {
        if (archetype) archetypeCards.set(archetype, (archetypeCards.get(archetype) ?? 0) + 1);
      }

      const length = [...terms.values()].reduce((sum, weight) => sum + weight, 0);
      totalLength += length;
      const index = this.entries.push({ card, tags, terms, length, nameTerms }) - 1;
      for (const term of terms.keys()) {
        const list = this.postings.get(term);
        if (list) list.push(index);
        else this.postings.set(term, [index]);
      }
    }
    this.averageLength = totalLength / Math.max(1, cards.length);
    this.taggedCount = tagsById.size;
    this.findArchetypes = buildArchetypeMatcher([...archetypeCards].filter(([, count]) => count >= MIN_ARCHETYPE_CARDS).map(([name]) => name));
  }

  get cardCount() {
    return this.entries.length;
  }

  /** Looks a card up by passcode; an alternate artwork's passcode finds the card it belongs to. */
  card(id: number): Card | undefined {
    return this.byId.get(id);
  }

  /** What the tags say about a card, shown when it is opened: its summary and its roles. */
  notes(id: number): CardNotes {
    const tags = this.tagsByCard.get(id);
    return { summary: tags?.summary, roles: tags?.roles ?? [] };
  }

  search(query: SearchQuery): SearchResult {
    const exclusions = (query.exclude ?? []).flatMap((text) => {
      const read = this.exclusion(text);
      return read ? [{ text, ...read }] : [];
    });
    const result = this.find(query, exclusions.map(({ covers }) => covers));
    return exclusions.length ? { ...result, excluded: exclusions.map(({ text, chips }) => ({ text, chips })) } : result;
  }

  /**
   * Reads something to leave out the way a search for it would be read, and returns the test for
   * the cards it covers: the cards that search would find.
   */
  private exclusion(text: string): { chips: string[]; covers: (entry: Entry) => boolean } | null {
    const asked = text.toLowerCase().replace(/\s+/g, " ").trim();
    // On its own a kind means the cards of that kind, not every card whose text mentions it.
    const kind = KIND_ALONE.exec(asked)?.[1] as CardKind | undefined;
    if (kind) return { chips: [`Card is: ${kind[0]!.toUpperCase()}${kind.slice(1)}`], covers: ({ card }) => card.kind === kind };

    const reading = this.read(asked);
    if (reading) {
      const leftover = [...new Set(tokenize(reading.query.text))];
      return {
        chips: reading.chips,
        covers: (entry) => matchCard(entry.card, entry.tags, reading.query) !== null && leftover.every((term) => entry.terms.has(term)),
      };
    }

    const terms = [...new Set(tokenize(asked))];
    if (!terms.length) return null;
    return { chips: [`Words: ${asked}`], covers: (entry) => terms.every((term) => entry.terms.has(term)) };
  }

  private find(query: SearchQuery, excluded: ((entry: Entry) => boolean)[]): SearchResult {
    const passes = buildFilter(query);
    const matchesFilters = (entry: Entry) => passes(entry) && !excluded.some((covers) => covers(entry));
    const text = query.text ?? "";
    const page = (scored: Scored[], reading?: SearchResult["reading"]): SearchResult => {
      const offset = query.offset ?? 0;
      const hits = scored.slice(offset, offset + (query.limit ?? 30)).map(({ entry, score }) => ({ card: entry.card, tags: entry.tags, score }));
      return { total: scored.length, hits, reading };
    };

    const synergy = query.literal ? null : this.synergyTarget(text);
    if (synergy) return this.searchSynergy(synergy, matchesFilters, query);

    const reading = query.literal ? null : this.read(text);
    if (reading) {
      const scored = this.searchEffects(reading.query, matchesFilters);
      if (scored.length) return page(scored, { chips: reading.chips, matched: true });
      return page(this.searchText(text, matchesFilters), { chips: reading.chips, matched: false });
    }
    return page(this.searchText(text, matchesFilters));
  }

  /** The archetype a search asks for partners of ("synergy with clown crew"), when it has a profile. */
  private synergyTarget(text: string): string | null {
    const asked = text.toLowerCase().replace(/["“”?.!]/g, " ").replace(/\s+/g, " ").trim().replace(QUESTION_OPENING, "");
    for (const pattern of SYNERGY_PATTERNS) {
      const target = pattern.exec(asked)?.[1];
      if (!target) continue;
      const name = target.replace(/^(?:the|a|an|my) /, "").replace(/ (?:decks?|cards?|archetype|engine|monsters)$/, "");
      // The name as typed, then without a plural "s" ("true dracos").
      const known = this.profiles.get(name) ?? this.profiles.get(name.replace(/s$/, ""));
      if (known) return known.archetype.toLowerCase();
    }
    return null;
  }

  /** Cards from outside an archetype that fit what its profile says the deck wants. */
  private searchSynergy(key: string, matchesFilters: (entry: Entry) => boolean, query: SearchQuery): SearchResult {
    const { archetype, profile } = this.profiles.get(key)!;
    let found = this.partners.get(key);
    if (!found) {
      found = findPartners(profile, archetype, this.entries);
      this.partners.set(key, found);
    }
    const { hooks, partners } = found;
    const fitting = partners.filter(({ index }) => matchesFilters(this.entries[index]!));
    const offset = query.offset ?? 0;
    return {
      total: fitting.length,
      hits: fitting.slice(offset, offset + (query.limit ?? 30)).map(({ index, fits }) => {
        const { card, tags } = this.entries[index]!;
        return { card, tags, score: fits.length, fits: fits.map((at) => hooks[at]!.hook.label) };
      }),
      reading: { chips: [`Synergy with: ${archetype}`], matched: true },
      synergy: {
        archetype,
        plan: profile.plan,
        hooks: hooks.filter(({ ignored, matches }) => !ignored && matches > 0).map(({ hook, matches }) => ({ label: hook.label, why: hook.why, matches })),
      },
    };
  }

  /** Reads the search as an effect query, unless it is better taken as a card name. */
  private read(text: string) {
    const reading = interpret(text, this.findArchetypes);
    if (!reading) return null;
    // A card's whole name is that card, even when its words read as an effect: "Monster Reborn" is
    // the Spell, not every monster that revives something.
    if (this.isCardName(text, { whole: true })) return null;
    const { does, reactsTo, roles, quick } = reading.query;
    if (!does && !reactsTo && !roles.length && !quick && this.isCardName(text)) return null;
    return reading;
  }

  /** Whether the words all come from one card's name; with `whole`, whether they are all of its name. */
  private isCardName(text: string, { whole = false } = {}): boolean {
    const terms = [...new Set(tokenize(text))];
    if (!terms.length) return false;
    const rarest = terms.map((term) => this.postings.get(term) ?? []).sort((a, b) => a.length - b.length)[0]!;
    return rarest.some((index) => {
      const { nameTerms } = this.entries[index]!;
      return terms.every((term) => nameTerms.includes(term)) && (!whole || new Set(nameTerms).size === terms.length);
    });
  }

  /** Cards whose tags satisfy the effect query: most specific first, then most viewed. */
  private searchEffects(query: EffectQuery, matchesFilters: (entry: Entry) => boolean): Scored[] {
    const queryTerms = [...new Set(tokenize(query.text))];
    const textScores = queryTerms.length ? this.scoreTerms(queryTerms) : null;

    let candidates: (Scored & { matchedTerms: number })[] = [];
    for (const [index, entry] of this.entries.entries()) {
      if (!matchesFilters(entry)) continue;
      const specificity = matchCard(entry.card, entry.tags, query);
      if (specificity === null) continue;
      candidates.push({ entry, score: specificity, matchedTerms: textScores?.get(index)?.matched ?? 0 });
    }
    // Leftover words ("2" in "draw 2 cards") narrow the results to cards that contain them, when any
    // do. They do not rank: among cards that all fit the effect, the well-known ones are the useful ones.
    const mostTerms = Math.max(0, ...candidates.map((candidate) => candidate.matchedTerms));
    candidates = candidates.filter((candidate) => candidate.matchedTerms === mostTerms);

    return candidates.sort((a, b) => b.score - a.score || b.entry.card.views - a.entry.card.views);
  }

  private searchText(text: string, matchesFilters: (entry: Entry) => boolean): Scored[] {
    const queryTerms = [...new Set(tokenize(text))];
    const scored: Scored[] = [];

    if (queryTerms.length === 0) {
      for (const entry of this.entries) {
        if (matchesFilters(entry)) scored.push({ entry, score: 0 });
      }
    } else {
      const candidates = [...this.scoreTerms(queryTerms)].filter(([index]) => matchesFilters(this.entries[index]!));
      // Keep only the cards that match as many query words as the best card does, so the result
      // count means something. Long queries may miss one word, since nobody phrases those exactly.
      const bestMatched = Math.max(0, ...candidates.map(([, { matched }]) => matched));
      const required = Math.max(1, bestMatched - (queryTerms.length >= LONG_QUERY_TERMS ? 1 : 0));

      for (const [index, { score, matched }] of candidates) {
        if (matched < required) continue;
        const entry = this.entries[index]!;
        const coverage = (matched / queryTerms.length) ** 3;
        let nameScore = 0;
        if (queryTerms.every((term) => entry.nameTerms.includes(term))) {
          const exact = entry.nameTerms.length === queryTerms.length;
          nameScore = NAME_MATCH_SCORE * (exact ? 2 : 1) + 10 * Math.log10(1 + entry.card.views);
        }
        scored.push({ entry, score: score * coverage + nameScore });
      }
    }

    // Popularity breaks ties, and orders results when there is no text query.
    return scored.sort((a, b) => b.score - a.score || b.entry.card.views - a.entry.card.views);
  }

  /** BM25 score per card for a set of terms, with how many of the terms each card contains. */
  private scoreTerms(queryTerms: string[]): Map<number, { score: number; matched: number }> {
    const scores = new Map<number, { score: number; matched: number }>();
    for (const term of queryTerms) {
      const postings = this.postings.get(term);
      if (!postings) continue;
      const idf = Math.log(1 + (this.entries.length - postings.length + 0.5) / (postings.length + 0.5));
      for (const index of postings) {
        const entry = this.entries[index]!;
        const frequency = entry.terms.get(term)!;
        const norm = BM25_K1 * (1 - BM25_B + (BM25_B * entry.length) / this.averageLength);
        const current = scores.get(index) ?? { score: 0, matched: 0 };
        current.score += (idf * frequency * (BM25_K1 + 1)) / (frequency + norm);
        current.matched++;
        scores.set(index, current);
      }
    }
    return scores;
  }
}

function buildFilter(query: SearchQuery): (entry: Entry) => boolean {
  const checks: ((entry: Entry) => boolean)[] = [];
  const { kinds, attributes, monsterTypes, subtypes, roles, levelMin, levelMax, format, mdRarities, genesysMin, genesysMax } = query;

  if (kinds?.length) checks.push(({ card }) => kinds.includes(card.kind));
  if (attributes?.length) checks.push(({ card }) => !!card.attribute && attributes.includes(card.attribute));
  if (monsterTypes?.length) checks.push(({ card }) => !!card.monsterType && monsterTypes.includes(card.monsterType));
  if (subtypes?.length) checks.push(({ card }) => subtypes.every((subtype) => card.subtypes.includes(subtype)));
  if (roles?.length) checks.push(({ tags }) => !!tags && roles.every((role) => tags.roles.includes(role)));
  if (levelMin != null || levelMax != null) {
    checks.push(({ card }) => {
      // Rank and Link Rating stand in for Level on Xyz and Link Monsters.
      const level = card.level ?? card.rank ?? card.linkRating;
      return level != null && level >= (levelMin ?? 0) && level <= (levelMax ?? 13);
    });
  }
  if (format) checks.push(({ card }) => card.formats.includes(format));
  if (mdRarities?.length) checks.push(({ card }) => !!card.mdRarity && mdRarities.includes(card.mdRarity));
  if (genesysMin != null || genesysMax != null) {
    checks.push(({ card: { genesysPoints: points } }) => points != null && points >= (genesysMin ?? 0) && points <= (genesysMax ?? Infinity));
  }

  return (entry) => checks.every((check) => check(entry));
}
