# Search YGO

The site at [searchygo.com](https://searchygo.com).

Search every Yu-Gi-Oh! card by what it does. A model reads each card once and writes structured
tags (what the effect does, what it costs, what it reacts to, what it supports); the site searches
those tags plus the card text.

Searches such as "special summon a WATER monster from the GY", "hand traps that negate" or
"triggers when banished" are read into the same vocabulary as the tags and answered from them.
The page shows how each search was read, and anything the rules do not recognise is matched
against card text instead.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the site at http://localhost:3000 |
| `pnpm cards:fetch` | Re-download the card database from YGOPRODeck into `data/raw/` |
| `pnpm cards:prepare` | Normalize the raw download into `data/cards.json` |
| `pnpm cards:tag --dry-run` | Show what the tagging job would send and a rough cost |
| `pnpm cards:tag --sample 40 --sync` | Tag a small spread of cards now, to check quality |
| `pnpm cards:tag` | Tag everything still untagged through Claude's Batch API |
| `pnpm cards:tag --provider deepseek` | Run the tagging job on DeepSeek instead |
| `pnpm cards:tag --provider deepseek --budget 4.50` | The same, stopping once about $4.50 is spent |
| `pnpm cards:review <file>` | Print a tags file next to the card text, to judge quality by eye |
| `pnpm cards:synergy --dry-run` | Show what the synergy job would send and a rough cost |
| `pnpm cards:synergy --provider deepseek --only "Clown Crew"` | Profile the named archetypes and print what each profile finds |
| `pnpm cards:synergy --provider deepseek` | Profile every archetype not yet profiled |
| `pnpm cards:search "draw 2 cards"` | Run a search from the terminal |
| `pnpm cards:images` | Download the card images still missing from `public/cards/` |

Tagging needs `ANTHROPIC_API_KEY` or `DEEPSEEK_API_KEY` in `.env` (see `.env.example`). Pass
`--model` to choose the model within a provider. The most-viewed cards are tagged first and
already-tagged cards are skipped, so a run can stop early and resume, and after a new set it is
just: fetch, prepare, tag.

## Layout

- `src/lib/tags.ts`, `src/lib/vocabulary.ts`: the tag schema and its vocabulary
- `scripts/tagging-prompt.ts`, `scripts/tagging-examples.ts`: the tagging instructions and the
  hand-written examples that define the conventions
- `scripts/tag-cards.ts`: the tagging job; writes `data/tags/tags.jsonl`
- `scripts/tag-cleanup.ts`: drops archetypes and card names the card text does not actually quote
- `src/lib/synergy.ts`: synergy search ("synergy with Tearlaments"). A model profiles each archetype
  once (`scripts/profile-archetypes.ts`, instructions in `scripts/synergy-prompt.ts`), writing what
  kinds of outside card help it to `data/synergy/profiles.jsonl`; the search finds those cards from
  the tags, so answering costs nothing
- `src/lib/query.ts`: reads a plain-English search into an effect query, using phrase rules (no
  model call per search)
- `src/lib/effect-match.ts`: decides whether a card's tags satisfy an effect query
- `src/lib/search.ts`: the search index, which answers effect queries from the tags and falls back
  to text relevance; `src/app/api/search/route.ts`: its HTTP endpoint
- `src/components/`: the page; `tokens.css`: every colour, font and spacing value it uses
- `src/lib/deck.ts`: the deck builder's rules and the two formats it reads and writes, `.ydk` files
  and YDKe links; `src/lib/use-deck.ts`: the deck being built, kept in the browser's storage;
  `src/app/api/cards/route.ts`: looks cards up by passcode when a deck is loaded or imported
- `src/lib/motion.ts`: the animation, built on [anime.js](https://animejs.com); results behave like
  cards dealt onto a mat
- `public/textures/`: the paper and foil textures (the halftone on the mat is drawn in CSS)

Card data comes from [YGOPRODeck](https://ygoprodeck.com/api-guide/). Their terms ask that card
images are downloaded and self-hosted rather than hotlinked, so `pnpm cards:images` downloads the
small images into `public/cards/` (about 400 MB, not committed).

The same download carries each card's Master Duel rarity and its Genesys points (the TCG list).
Both are shown on every card and can be filtered on. When Konami changes the point list, run
`pnpm cards:fetch` and `pnpm cards:prepare`; nothing needs re-tagging.

Decks are exchanged with other apps as `.ydk` files (YGOPro, EDOPro, Dueling Book, YGOPRODeck) or
as YDKe links for the clipboard. Alternate-artwork passcodes in an imported deck are matched to
their card. The builder enforces deck sizes and the three-copy limit, and totals Genesys points and
Master Duel rarities, but it does not apply any Forbidden & Limited list.

The textures are prepared from [Texturelabs](https://texturelabs.org) photographs (Paper 331 and
193). Their licence allows use in a site like this but not passing on the original files, so
the originals stay in `design-src/`, which is not committed.
