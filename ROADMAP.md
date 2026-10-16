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

- **Plain search switch.** A setting that turns off what AI made: always match the card text's
  words, hide roles and summaries, turn off synergy, and leave the AI-written keywords out of the
  ranking. Asked for in a comment.
- **Cards a card counters.** The reverse of counters, shown on each card: "Counters: Tearlaments,
  Branded, Kashtira…".
- **Report a problem.** A link on each card or search to say a result is wrong.
- **Shareable deck links.** Open a deck from a link, without importing a file.
- **Result sorting.** By name, ATK/DEF, Level, release date.
- **Failed-search log.** Note searches that find nothing or get read badly, to see what to teach the
  reader next.
- **Re-profile synergy hooks** that still find nothing (77 hooks across the profiles).
- **Learning from real games.** Feed actual game data (replays, deck lists, tournament results) to
  the profiles or a model, so synergy and counter answers reflect how decks are really played,
  including lines and interactions no one has written down. Open: fine-tune a model, or use the data
  to check and rank the profiles we already make.
- **Connector / deep search.** An MCP endpoint so people can bring their own model, and a live-model
  "deep search" for long questions.

## Done

- Announced-but-unreleased cards kept (anything with a Konami ID, e.g. "Mind Scan")
- GY / hand / banished effect searches ("Spells with GY effects")
- Player terms: recruiters, floaters, tutors; format and release-year filters
- Opening deck cards in the card pop-up
- Synergy profiles from GLM-5.3
- Gallery view, condensed mobile search box
- Deck builder with .ydk / YDKe import and export, banlist marks, Genesys points, Master Duel rarity
