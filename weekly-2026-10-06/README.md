# Velvet Bid

A simultaneous auction salon for 2–8 friends: spend a small purse across six curios, and win each lot with the highest **unique** bid. Matching bids cancel one another; a clever lower bid can win.

## Rules

Six lots worth 2–7 points appear in seeded shuffled order. Each has five seconds of bidding and a 1.5-second reveal. Set an offer, then seal it; unsealed offers count as passes. Only the winner pays. Zero is always a pass. If no positive bid is unique, the lot remains unsold. There is no elimination and nobody has a reaction-speed advantage: every auction uses its whole clock.

Each round starts with 24 coins. A player behind the connected match leader gets up to six extra coins (one per point behind). Coins do not carry between rounds; points do. Reach 35 points with a unique lead to win the match. A round takes about 41 seconds including its opening countdown. Disconnected seats cannot bid or win.

## Input

- `adjust`: -1 / 0 / 1, decrease / neutral / increase the offer. Left/A and Right/D, gamepad axis 0, separate − and + touch buttons. Acts immediately on a direction change, then repeats every eight ticks while held. Offers clamp to the remaining purse and nine coins.
- `seal`: 0 / 1, seal the current offer on the press edge; Space, gamepad button 0, and the SEAL touch button. Sealed offers cannot change. Seal zero to pass.

Missing intents and numeric zero are neutral. Inputs during countdown and reveal do not queue actions. Enter advances rounds for the host. All controls have keyboard and individual touch buttons.

## Snapshot

No simulated spatial positions: the client lays out fixed bidder placards from seat order. There are no interpolated fields.

| Field | Type | Meaning |
|---|---|---|
| `k` | uint32 | Tick, incremented on every step |
| `over` | bool | Round ended |
| `phase` | uint8 | 0 ready, 1 bidding, 2 reveal, 3 finished |
| `ready` | uint8 | Opening countdown remaining |
| `t` | uint16 | Ticks remaining in bidding or reveal |
| `lot` | uint8 | Zero-based current lot |
| `values` | uint8 × 6 | Shuffled lot values |
| `bid` | uint8 per player | Current offer; other offers are drawn face-down until reveal |
| `wallet` | uint8 per player | Coins remaining |
| `locked`, `gone` | bool per player | Sealed offer; disconnected seat |
| `last` | int8 | Winner of the revealed lot, or -1 |
| `adjusted`, `sealed`, `sold` | players | One-tick events for changed offers, sealed offers, awarded points |
| `beep`, `go`, `revealed`, `ended` | bool | One-tick countdown, opening bell, reveal and round-end events |

Snapshot bids are presentation-hidden, **not cryptographically secret**. This is a trusted-friends game, with the engine's normal host authority. A late spectator can draw the entire board from one snapshot. Coins, seals, and reveal state persist; cosmetic rings consume `ctx.events`, never raw event lists.

## Round lifecycle

`startRound()` increments round, resets tick, six-lot schedule, purses, offers, locks and countdown (60 ticks), preserving scores and disconnect flags. A 150-tick auction resolves all offers simultaneously using a ten-entry frequency table. Exactly one highest unique positive sealed offer wins its lot, scores its value and pays its offer. Reveal lasts 45 ticks, then offers reset for the next lot. The sixth reveal ends the round. `winner(target)` requires a connected unique leader at or above target; ties play another round. `disconnect(index)` keeps the seat in all arrays but cancels its current offer and excludes it in every later round.

## Visual identity

An intimate Art Deco auction salon, not a casino or a terminal. Palette: aubergine `#281b30`, velvet `#38243f`, ivory `#f9edcf`, antique brass `#d6b878`, and muted mauve `#bfaac4`. Eight player inks are rose, sage, periwinkle, apricot, lilac, sea-glass, parchment, and ochre. Typeface: Georgia / Palatino / Times New Roman serif for the catalogue; system sans-serif for controls and instructions. Layout: a numbered catalogue cover alongside a reservation form; during play a framed auction stage beside a compact ledger, collapsing to one column on phones. Lobby copy is warm, brief, and slightly theatrical. Canvas: brass double rules, geometric jewel silhouettes, large lot value and clock, numbered bidder envelopes, an ivory double outline around your own placard. No remote assets. Motion is restrained expanding seal rings, disabled under reduced-motion preference.

## Design notes

The big lot and draining clock explain the stakes; the HUD gives the local offer, purse and next action. Eight bidders fit a four-by-two grid on a fixed 640×560 stage, with names in the page ledger. Numeric seat labels and sealed/revealed shapes avoid colour-only information. Three 96px touch controls fit a 360px viewport. Ties cancel rather than favouring a seat. The trailing-player purse allowance enables a comeback without changing lot value. The bot varies risk by seat and commits before the deadline.

## Registration and deployment

Only `game-entry.json` is authored here. The coordinator adds the entry to `public/games.json` and the automation catalog, with `url: null`, and excludes this directory from the root upload. After merge the coordinator runs:

```sh
./deploy.sh weekly-2026-10-06 super
```

This records the actual Wasmer URL and redeploys the superapp. No deployment is performed by this job.

## Checks

Executed from the repository root on 2026-10-06:

- `cd weekly-2026-10-06 && RECORD=1 node test/game.test.mjs` — passed; fixture recorded after the final simulation change. Three complete rounds, 3,690 ticks, final scores 19 / 17 / 10 / 35.
- `cd weekly-2026-10-06 && node test/game.test.mjs` — 14 tests passed, including exact auction resolution, tie cancellation, payment, deadline, input repetition, one player, disconnect persistence, comeback purses, codec round-trips and frozen intents at 1–8 seats.
- `node /app/check_game.mjs . weekly-2026-10-06` — passed. Engine 1.0.2; schema `845ce4df`; probe 27 bytes per player against 100 allowed.
- `node scripts/conformance.mjs weekly-2026-10-06 --static` — all 18 rows passed; 22 page roles, three touch buttons; full snapshot 66 bytes at eight seats. Largest four-seat fixture snapshot 58 bytes against 400 allowed.
- `node /tmp/velvet-bid-smoke.mjs` — additional headless check passed: 11,061 mock-surface draws and three bot-played catalogues each at 1, 2 and 8 seats. All drawing numbers finite, scoreboard hooks executed, each run scored points. This is not browser validation.

Pending for the reviewer: full browser conformance; desktop/360px screenshots (lobby, late round, results, spectator); two- and eight-player browser play; actual touch-button play; two-tab join/invite/round advance; audio and reduced-motion review; soak. Pending for the coordinator: merge, deployment packaging/provider checks, production health and conformance, production two-browser and phone invitation checks, real catalog URL and superapp rollout. No credentials, deployments, commits or coordinator-owned files were changed.


## Automated check status

The Wasmer job ran JavaScript syntax, the engine's simulation and snapshot checks, fixture replay,
the simulation tests, and the static conformance tier.
The browser conformance tier, two-browser gameplay, invite behavior, and production deployment remain pending.
The PR registers the game in public/games.json with a pending URL. Deploy the game and superapp to publish it.
Complete the repository AGENTS.md checklist before calling this game done.
