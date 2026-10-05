---
name: make-game
description: Create a new browser multiplayer game in this repository, or substantially change an existing one (rules, drawing, page, sound, controls). Use when asked to add, build, design, rework, polish or fix the feel of a game under a game directory such as fuse/ or achtung/. Covers scaffold, design, the build-test-play-look loop, the quality bar and the gates before done.
---

# Make a game

The engine owns networking, lobby, loop, input, audio and scaling. Your time
goes into the game: its rules, its feel, its look. Do not read engine source;
everything is documented. If something is not, that is a doc bug: find the
answer, then add it to `engine/README.md`.

## 1. Read, in this order

1. `AGENTS.md` sections 1 to 3 (the model, what you write, the steps) and
   section 6 (design checklist).
2. `engine/README.md`: "Complete example" in full. Then keep these open as
   reference: "`startGame(config)`", "Surface", "Arena and screen", "Page
   slots", "Sound", "How it behaves", "Game feel cookbook".
3. One finished game for the level to reach: `fuse/README.md`,
   `fuse/public/client.js`, `fuse/public/style.css`. `trapdoor/` is a second
   one, with a grid board and a light theme. Do not copy their look.

## 2. Scaffold

```bash
node scripts/new-game.mjs <slug> --name "<Display name>" --description "<One sentence.>"
```

Never copy another game's directory. For an existing game, skip this.

## 3. Design before code

Write in the game's `README.md`: the pitch in one sentence, the rules, then
**Input**, **Snapshot**, **Round lifecycle**. Hold the idea against
`AGENTS.md` section 6 now. Decide on paper:

- What does a player do in the first ten seconds, and how do they know?
- What is the one thing that decides a round, and how big is it on screen?
- What does an eliminated player do? What catches the leader?
- Does it work with 2 players? With 8? On a 360 px phone with thumbs?
- Each moment that needs a sound or a burst: an event field. Each thing
  visible for longer than a tick: a counter or an age field.
- The look: a palette, a type stack from "Typography", a tone of voice.

## 4. The loop

Write `test/bot.mjs` as soon as the rules run: `(snapshot, info) => keys to
hold`, a few lines (`engine/README.md`, "Bots"). Random players die in the
first seconds; the bot is how you see round 2, the endgame and a full room.

Repeat until nothing is left to fix:

```bash
cd <slug> && RECORD=1 npm test && npm test && cd ..      # after a rule change; plain npm test otherwise
node scripts/conformance.mjs <slug> --static
node scripts/play.mjs <slug> --phone --rounds 3 --shots <scratch>/<slug>-shots
```

Then **open the PNG files and look at them**: `01-lobby-desktop`,
`02-lobby-phone`, a few `04-game-host-r*`, `04-game-guest-1-r*` (the phone),
every `05-over-*`, `06-spectator`. Before the gates, run it once with
`--guests 1` and once with `--guests 7 --no-late`. Read the JSON summary for `problems`, `hud`,
`scores` and `snapshot`. Ask of each picture: which one is me, what is
dangerous, what just happened, who is winning, could I play this with my
thumbs? Write down what is wrong, fix it, run again.

Order of work: rules and tests first (`game.js`, headless), then a plain
`draw` and the bot, then the page and stylesheet, then feel (events, particles, shake,
sound, scoreboard, labels), then the phone.

Limits: one server and one headless browser at a time. Run tests and tools
one after another, never in parallel.

## 5. Quality bar

- Every item of `AGENTS.md` section 6 holds on the screenshots.
- The stylesheet and the page copy are this game's own. No other game in the
  repository looks like it.
- Every player action has a visible answer and a sound.
- The phone screenshot shows the board, the status line and the controls
  together, and the controls drive the game.
- Tests state the rules: at least two scenarios with exact ticks or scores,
  one with a single player.

## 6. Gates before you say done

```bash
(cd <slug> && npm test)
node scripts/conformance.mjs <slug>                 # full tier, every row PASS
node scripts/soak.mjs <slug> --duration 60          # PASS
node scripts/play.mjs <slug> --phone --rounds 3 --shots <dir>  # exit 0, and you looked
```

Then `AGENTS.md` section 5. Deploy only when asked: `./deploy.sh <slug> super`.

## 7. Do not investigate; it is documented

| Question | Answer in `engine/README.md` |
|---|---|
| What can `surface` draw, colours, alpha, gradients, text fonts | "Surface" |
| How big is the board, why is it tiny on a phone, blurry text | "Arena and screen" |
| Why did my effect fire twice or never on a guest | "Events and state": use `ctx.events(field)` |
| When does `draw` run, how do I detect a round start | "The draw lifecycle": `onRound`, `ctx.round()` |
| A clock for animation | `ctx.time()`, `ctx.dt()` in "Draw context" |
| Mark the local player or a state in the scoreboard | "Scoreboard": `li.you`, `state`, `note` |
| A thumb stick, sliding buttons | "Touch controls": `data-engine-stick` |
| Space starts the next round while it is my action key | "Rounds and matches": `nextKey: "Enter"` |
| Which sounds exist, pitch from game state | "Sound" |
| Banner text that depends on the game state | "Labels": the `info` argument |
| Web fonts, CDN, remote images | Not allowed. "Nothing from another origin", "Typography" |
| Late joiners, a player leaving, one-player safety | "How it behaves", "The simulation" |
| Screenshots, driving a page, `__engine` | "Look at your game" |
| Players that survive past round 1 | "Bots": `test/bot.mjs` |
| A label or a colour that follows the player's state | "Game feel cookbook": `data-` attributes set from `draw` |
| Rotation, rounded boxes, letter-spacing, a smooth ring | "Surface"; `ctx.tickFraction()` in the draw context table |
| Board size in tests against conformance | "The simulation": `ARENA`, `arenaOf` |
| A row of conformance or the soak failed | `AGENTS.md` section 3.8, the failure table |
