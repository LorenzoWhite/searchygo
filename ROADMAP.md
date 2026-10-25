# Roadmap

What we plan to add to Search YGO, in the order we mean to do it. Done items move to the bottom.

## Next

### 1. Counters ("how to beat X")

Search for the cards that stop an archetype: "counters to Tearlaments", "how to beat Snake-Eye",
"Branded side deck", "what stops Kashtira".

- **Counter profiles.** A model writes one per archetype, as it did for synergy: what the deck
  relies on (mills from the Deck, GY effects, many Special Summons, Fusion Summons…) and, for each,
  the kind of card that stops it. Each weakness is a hook in the existing format (does / reacts_to /
  card / phrases), matched against the tags we already have, plus named cards where the answer is
  specific.
- **Whose card is whose.** Synergy hooks describe your own cards working together. Counter hooks
  describe your cards acting on the opponent's ("banish from the opponent's GY", "negate when the
  opponent Special Summons"), which the tags' player field already records.
- **Going first / going second.** Each weakness says whether it is answered before the combo (hand
  traps, floodgates) or after it (board breakers for the board it ends on).
- **Ranking.** Synergy ignores hooks matching over 5% of cards as too generic, but for counters the
  generic staples (Ash Blossom, Infinite Impermanence, Nibiru) are often the answer. Show two groups:
  staples that hit it, and counters specific to the deck. Each result says what it stops
  ("Stops: mills from the Deck · GY effects").
- **Search phrasing.** Needs an archetype name with it, so "counter traps" and "Spell Counter" keep
  their ordinary meaning.
- **Process.** Prompt with hand-written examples → sample of ~20 archetypes, checked by hand on decks
  we know (Clown Crew, Branded, Snake-Eye) → full run on GLM-5.3 through OpenCode Go (~$5, two or
  three 5-hour windows) → search integration.
- **Decided.** Staples (Ash, Imperm…) show up, named first; the going first / going second split is
  shown on each result.
- **Combined searches.** "Branded synergy that counters Spright": cards that work with one deck and
  stop another, ranked by how well they counter, with both the "Fits" and "Stops" lines.
- **Status.** Search built ("counters to X", "how to beat X", "X side deck", "Branded synergy that
  counters Spright"), switched on only where `SEARCHYGO_COUNTERS=1` is set: on in `.env.local`, off
  on the live site until it is set in Vercel. Profiles are made 50 a day, newest archetypes first
  (`pnpm cards:synergy --job counters --order recent --limit 50 --provider opencode --model glm-5.3`).
- **Checked so far.** Sample of Ninja, Clown Crew, Radiant Typhoon, Spright and Live☆Twin, judged by
  a player. Lessons now in the prompt: GY hate only hurts decks whose effects activate in the GY,
  not decks that trigger on being sent or Tributed (Clown Crew); stopping draws counts (Droll, Veiler
  on Biancaviso); boards standing on Continuous Traps lose to backrow removal (Ninja → Harpie's
  Feather Duster). Clown Crew is a hand-written example; the checked Ninja, Radiant Typhoon and
  Live☆Twin profiles are kept as they are.
- **Limits.** The model knows matchups from training and card text, not the live meta, so the newest
  archetypes may get thinner profiles. Hybrid decks (Snake-Eye Fire King) combine two profiles
  rather than being understood as one deck.

### 2. Deck image export

One click in the deck panel downloads a picture of the deck, laid out like Master Duel's deck view:
deck name at the top, then the Main, Extra and Side Decks as rows of card images with their counts,
and each card's Master Duel rarity and limit marks. For showing a deck to people quickly.

- Drawn in the browser on a canvas, then saved as a PNG; on phones, offered through the share sheet
  where the browser supports sharing files.
- The card images come from img.searchygo.com, a different origin, so the R2 bucket needs a CORS
  rule allowing searchygo.com; otherwise the browser will not let the canvas be saved.
- About 10 cards to a row, as in Master Duel; the image is sized for sharing on Discord and social
  sites.

### 3. Automatic weekly card refresh

New cards (reveals like "Mind Scan", new sets, banlist and Genesys point changes) reach the site by
themselves, with nothing to run by hand.

- **Where it runs.** A scheduled GitHub Actions workflow, once a week, on GitHub's machines, so no
  computer has to be on.
- **Steps.** Fetch the card database → prepare it → tag only the cards that are new (DeepSeek Flash,
  a cent or two a week) → download and upload images only for cards the R2 bucket does not have yet
  (not all 14,000) → commit the changed data files → the push deploys through Vercel.
- **Order matters.** Images go up before the data is committed, so a new card never appears on the
  site before its picture does.
- **Setup once.** The DeepSeek key and the four R2 values go into the repository's GitHub secrets
  (not into the code). A spending cap on the tagging step (`--budget`) and a failed run sending an
  email instead of deploying half-finished data.
- **Until then**, by hand: `pnpm cards:fetch`, `pnpm cards:prepare`, `pnpm cards:tag --provider
  deepseek`, `pnpm cards:images`, `pnpm cards:upload`, then commit and push.

## Later

- **Cards a card counters.** The reverse of counters, shown on each card: "Counters: Tearlaments,
  Branded, Kashtira…".
- **Report a problem.** "Report a mismatch" on each synergy and counter result (saying how the card
  fails to work) and "Suggest a card" under those panels. Reports are checked against card text in
  feedback triage; only cards that cannot work are taken out, and approved fixes go in
  `data/overrides.json`. *Status:* built, on locally (`NEXT_PUBLIC_SEARCHYGO_REPORTS=1`); the live
  site needs Upstash Redis connected in Vercel first, then the same variable. Later, possibly: the
  same link on ordinary searches.
- **Shareable deck links.** Open a deck from a link, without importing a file.
- **Failed-search log.** Note searches that find nothing or get read badly, to see what to teach the
  reader next.
- **Re-profile synergy hooks** that still find nothing (77 hooks across the profiles).
- **Related cards.** A button on every card (tile and pop-up) that searches for the cards related
  to it, each result saying why: names this card → named on this card → same archetype → archetype
  support from outside it (including archetypes named in quotes, so "Mind Scan" finds the Toon cards
  though the data gives it no archetype) → similar effects worded differently (from the tags; asked
  for by @katiegrayx3637). It is an ordinary search, so it can be sorted, filtered, shared
  (`?related=<passcode>`) and typed ("related to Dark Magician"). Phase 1 (the first four links) is
  done. Phase 2, similar effects, is next: compare each card's tags (what its effects do, from where,
  at what timing) with every other card's and tune the ranking so "similar" means similar to a player.
  It also gives cards with no archetype and no name links (Effect Veiler) something to show.
  - *Player-named groups.* Some groups players treat as one are not official archetypes, so
    related cards miss them: the Ghost Girls (Ash Blossom & Joyous Spring, Ghost Ogre & Snow Rabbit,
    Ghost Belle & Haunted Mansion, Ghost Mourner, Ghost Reaper, Ghost Sister), the Monarchs, and
    others. A small hand-kept list of these groups, treated like archetypes by related cards (and
    readable in searches: "ghost girls"), covers them; similar effects alone would mix them in with
    every other hand trap.
  - *Status.* Experimental: on locally (`NEXT_PUBLIC_SEARCHYGO_RELATED=1` in `.env.local`), off on
    the live site until it is set in Vercel.
- **What a card can fetch, and what can fetch it.** Two directions on the same reading of each
  effect's conditions (kind, Type, Attribute, Level, ATK/DEF, names): *every legal target of a card*
  (what Nightmell the Dark Bonder can summon; asked for by @Badbufon) and *what can search or summon
  a given card* (type "Duza the Meteor Cubic Vessel", get the cards that can fetch it; asked for by
  @st0rmerc00l8). Small World needs two steps (a bridge sharing exactly one property with each side),
  so it is its own piece.
- **Deck suggestions in the deck builder.** Suggest cards from what the deck already plays (its
  archetypes' synergy, its weak points). To brainstorm first: where suggestions appear, how they are
  ranked, and how they are explained.
- **Deck data from deck sites.** Use real deck lists for deckbuilding help: which cards decks of an
  archetype actually play, common tech and side choices, what is rising. Never republish deck lists:
  show statistics and link back to the source's deck pages.
  - *Sources.* YGOPRODeck (card API is public and rate-limited; no documented deck API), Master Duel
    Meta and Yu-Gi-Oh! Meta (one team, also Duel Links Meta; robots rules allow crawling, sitemaps of
    top decks, but no documented API), CardCluster (blocks automated visitors behind a bot challenge,
    so only with their permission). Step one is asking each for access.
  - *Adapters.* One per source, each turning that site's deck lists into one shape: source, link,
    date, format (TCG / OCG / Master Duel / Genesys), event and placing, Main/Extra/Side as passcodes
    (names matched with the deck importer's lookup). Each deck is labelled with its archetype from its
    cards, or the source's own label.
  - *Statistics, not lists.* Worked out at each refresh and kept as a small JSON file, like the
    synergy profiles: per archetype, format and month, the share of lists playing each card and its
    average copies (core / common / tech), the commonest side cards (real counter data), outside cards
    played with it (real synergy data), and what is rising.
  - *On the site.* "Decks like yours also play…" in the deck builder (compare the deck to real lists);
    "played in 41% of tournament lists" on synergy and counter results, ranking real choices first; a
    "What Clown Crew plays" summary linking to example decks on the source site.
  - *Refresh.* Weekly, in the automatic card refresh job: only decks newer than the last run, slowly,
    under a named user agent, crediting every source on the site.
  - *Order.* Contact YGOPRODeck and the Meta team → the first source that agrees, play rates for the
    most played decks → deck builder suggestions → more sources and trends.
- **Learning from real games.** Feed actual game data (replays, deck lists, tournament results) to
  the profiles or a model, so synergy and counter answers reflect how decks are really played,
  including lines and interactions no one has written down. Open: fine-tune a model, or use the data
  to check and rank the profiles we already make. Yugipedia's tips pages and decklists are
  candidate sources; a chat mode for long questions belongs with deep search below.
- **Connector / deep search.** An MCP endpoint so people can bring their own model, and a live-model
  "deep search" for long questions.

## Parked

Ideas written down but not planned, because the search already covers them another way.

- **"Or" in searches.** One search that finds cards doing any of several things ("pay LP or opponent
  gains LP"). Each part can already be searched on its own, so this is a convenience, not a fix.

## Done

- Related cards, phase 1: names it, named on it, same archetype, archetype support
- Advanced search panel; search by ATK/DEF; TCG set filter
- Result sorting: name, ATK, DEF, Level/Rank/Link, release date, popularity, either direction
- Credits page and YouTube feedback triage
- Two-deck synergy, "generic", "self mill" and kind-of-card support searches
- Announced-but-unreleased cards kept (anything with a Konami ID, e.g. "Mind Scan")
- GY / hand / banished effect searches ("Spells with GY effects")
- Player terms: recruiters, floaters, tutors; format and release-year filters
- Opening deck cards in the card pop-up
- Synergy profiles from GLM-5.3
- Gallery view, condensed mobile search box
- Deck builder with .ydk / YDKe import and export, banlist marks, Genesys points, Master Duel rarity
