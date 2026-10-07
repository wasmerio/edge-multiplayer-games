# Velvet Auction

A simultaneous, all-pay flower auction for 2–8 friends. Seal a bid for each rare bloom: matching bids cancel, and the highest unique bid wins its petals. Every sealed bid is spent, even a losing one. There is no movement, reflex target, survival, drilling or collection lane.

## Rules and design

Eight lots form a 42-second catalogue: two seconds to get ready, then four seconds to bid and one second to reveal per lot. Values are a seeded shuffle of 3, 4, 4, 5, 5, 6, 7, 8 petals; the next lot is previewed. Everyone starts with 8 coins and receives 3 before each later lot (purse capped at 15). Players behind the match leader start with 10 instead. Bid 1–9 coins or pass with zero. Sealing immediately spends the bid and cannot be undone. Unsealed selections do not enter the auction. At the deadline, each positive bid made by exactly one connected player is eligible; the highest such bid earns the bloom. If all bids collide or everyone passes, nobody scores. Example: 7, 7, 4 awards the bloom to 4. This is an all-pay auction, not a second-price auction.

Inputs are private in the normal presentation until the reveal; snapshots are not encrypted, so this is a friends game, not cheat-proof gambling. There are no purchases, stakes or real-world rewards. Match victory requires a unique connected leader with at least 24 petals, checked after the eighth reveal. No one is eliminated; the allowance brings broke bidders back for the next lot. All player counts use the same compact 640 × 480 board. A local diamond and numbered envelopes identify seats without relying on colour. The HUD gives the current action, the scoreboard carries names and purse amounts. Guest input latency near the deadline is inherent to host authority: seal early.

## Visual identity

- Palette: velvet plum `#281b32`, inset mulberry `#36243f`, ivory `#fff3dc`, lilac `#cbb5d2`, brass `#dfbd78`. Cancelled bids use coral `#ff827b` plus a cross, never colour alone.
- Player colours: eight botanical thread colours—orchid, sage, cornflower, honey, mauve, seafoam, peach and pearl—on plum envelopes.
- Typography: editorial serif headings (`Iowan Old Style`, `Palatino Linotype`, Palatino, Georgia, serif); system sans UI; monospace bid numerals.
- Layout: an auction catalogue with an oversized botanical medallion beside a registration slip. In play: board, action line, three 96px-minimum touch keys, then a compact ledger. Hairline rules and clipped-ticket corners, not arcade tiles or hazard tape.
- Copy: poised and playful, like a small flower auction house. Plain instructions always outrank flavour.
- Canvas: flat botanical engravings built from ellipses and arcs, a broad deadline rule, numbered sealed envelopes, brass coin dots and a large central flower. No external art or fonts. Reduced-motion clients suppress cosmetic particles; essential state never depends on motion.

## Input

`INTENT = { bid: -1 | 0 | 1, seal: 0 | 1 }`.

| Field | Keyboard / gamepad | Touch | Meaning |
|---|---|---|---|
| `bid` | Left/A and Right/D; axis 0 | Separate −1 and +1 buttons | Adjust selection immediately on direction change, repeat every 6 held ticks; clamp to 0…min(9, purse) |
| `seal` | Space; button 0 | Seal button | Commit once on the press edge, including a deliberate zero pass |

Missing and numeric-zero intents are neutral; opposing directions cancel. Countdown inputs are tracked but cannot bid or seal. Holding seal across lots cannot submit again without a release. Host advances with Enter (`nextKey`), not Space. Frozen engine intent arrays are never modified.

## Snapshot

`SNAPSHOT` is flat, with no interpolated fields: all positions are a fixed board layout, not moving simulation state. No floating positions are transmitted. Guests can draw any snapshot from scratch.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Tick, advancing on every step, even after over |
| `over` | bool | Catalogue ended |
| `phase` | uint8 | 0 ready, 1 bidding, 2 reveal, 3 done |
| `t` | uint16 | Ticks left in this phase |
| `lot` | uint8 | Current lot, 0…7 |
| `value`, `preview` | uint8 | Current and next petal values; preview 0 means last lot |
| `last` | int8 | Winner of this lot, or −1 |
| `purse`, `choice`, `offer` | uint8 per player | Remaining coins, selected bid, sealed bid |
| `locked`, `active` | bool per player | Has sealed; has not disconnected |
| `result` | uint8 per player | 0 none/pass, 1 unique but outbid, 2 cancelled tie, 3 winner |
| `petals` | uint8 per player | Petals won in this catalogue |
| `changed`, `sealed`, `awarded`, `cancelled` | player lists | One-tick adjustment, submission, score and collision events |
| `beep`, `opened`, `revealed`, `finished` | bool | One-tick ready beat, bidding opens, reveal, catalogue end |

Selection and sealed bids are rendered only for the local seat before reveal. Opponents' coin labels show their pre-seal balance until reveal, so spending does not disclose their offers indirectly; the ledger shows only choosing/sealed in that phase. Effects use `ctx.events`, never raw event arrays in draw. Persistent reveal feedback uses `result` and `phase`. The codec budget remains the engine default, 100 bytes/player/tick.

## Round lifecycle

`startRound()` increments round, resets tick, shuffles the eight values using only the injected RNG, sets phase 0 with 60 ticks remaining, restores connected purses (8, or 10 for trailing seats), and clears offers, selections, locks, results and catalogue petals. Scores and disconnected flags persist. The start countdown never spends money.

After 60 ticks, bidding opens. Each lot has exactly 120 bidding ticks, then 30 reveal ticks. The final bidding tick accepts input before settlement. Every new lot adds 3 coins (maximum 15), clears selection, offer and lock, and preserves held seal state. No early close for sealed players, so all clients have time to see and read the auction. `roundOver` becomes true after the last reveal, at tick 1260, or on the next step after all seats disconnect. Winner checks exclude disconnected seats and require the target plus a unique lead. Post-round steps advance the stream tick but cannot score again.

`disconnect(index)` marks that seat inactive and removes its bid from unresolved auctions without a refund; seats stay in every array and out of later catalogues. Awards already settled are not clawed back. The engine owns hosting, lobby, invitation, transport, interpolation and round advance; there is no game-authored networking or DOM lobby behaviour.

## Checks / shared notebook

Completed in this job on 2026-10-07:

- `cd weekly-2026-10-07 && RECORD=1 node test/game.test.mjs`: fixture recorded after the final rules change; all 18 tests passed.
- `cd weekly-2026-10-07 && node test/game.test.mjs`: all 18 tests passed, including rule scenarios, frozen/zero inputs, one-player safety, complete 1–8-player codec round-trips, budget, seed equality and replay.
- `node /app/check_game.mjs . weekly-2026-10-07`: passed on engine 1.0.2, schema `6516f5cc`; fixture has 3,783 records, three complete catalogues, final tick 1260 and scores 28/51/26/21.
- `node scripts/conformance.mjs weekly-2026-10-07 --static`: all 18 rows passed; 22 distinct page roles, three valid touch buttons, full eight-player snapshot 94 B against 800 B; largest reference snapshot 74 B / 400 B, mean delta 12.1 B.
- `node /tmp/velvet-check.mjs`: supplemental non-browser smoke test passed. Exercised the actual draw, scoreboard and bot for three catalogues at 1, 2 and 8 seats, including spectator views and 303,949 finite/range-checked surface calls. Bots won petals and reached match targets; peak encoded sizes 59/64/94 B. Also verified the retained import map byte for byte. This mock is not a visual or transport test.

Browser gameplay, screenshots at 360px, two/eight-player sessions, late spectator, full conformance and soak remain **pending**: this job has no browser. Phone layout is designed but not visually verified. Production health, actual URL, two-browser play and phone invite are **pending**; no deployment was attempted. All coordinator-owned scaffold files were left untouched.

Commands from the repository root:

```sh
(cd weekly-2026-10-07 && RECORD=1 node test/game.test.mjs)
(cd weekly-2026-10-07 && node test/game.test.mjs)
node /app/check_game.mjs . weekly-2026-10-07
node scripts/conformance.mjs weekly-2026-10-07 --static
```

`test/reference.mjs` scripts both intent fields for three full catalogues. `test/bot.mjs` varies valuation, patience and appetite by seat; it releases seal between lots. Browser reviewer: run `node scripts/play.mjs weekly-2026-10-07 --phone --rounds 3 --shots /tmp/velvet-shots`, then the two-player and eight-player configurations, and inspect the images. Test human touch separately with `--no-bot --phone`.

## Registration and deployment

`game-entry.json` contains display metadata. The coordinator adds entries to both catalogs; the superapp reads root **public/games.json**, not the automation catalog. The root entry has `url: null` until deployment reads the real URL from Wasmer. The coordinator also adds `/weekly-2026-10-07/` to root `.wasmerignore`.

After merge, the coordinator runs:

```sh
./deploy.sh weekly-2026-10-07 super
```

This deploys the game, records its actual Wasmer URL and redeploys the superapp. Commits, pushes, pull requests, protected scaffold files and deployment remain coordinator-owned.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
