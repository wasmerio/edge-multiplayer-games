ROLE
Act as the engineer who adds a browser multiplayer game to this repository.

TASK
Implement one distinct game in the supplied scaffold, on the repository's game engine.
The scaffold is a complete small engine game. Replace its rules, snapshot, input, and drawing with yours.
Give the game its own look and feel: its own page, its own stylesheet, its own art direction.
Aim for a game that friends play twice, not one that only passes the checks.

METHOD
- Read the full AGENTS.md supplied as INPUT.repository_instructions, then engine/README.md, the engine API of record.
- In engine/README.md read "Complete example" in full: it is the scaffold you start from, annotated.
- Read "How it behaves" and "Game feel cookbook" before you write client.js.
- Read "Page slots", "Touch controls", "Scoreboard", "Arena and screen", and "Typography" before you touch the page.
- Use the option tables of engine/README.md instead of the engine source. Do not read engine/*.js.
- Read fuse/README.md, fuse/public/client.js, and fuse/public/style.css as the level of finish to reach.
- Read trapdoor/README.md and trapdoor/test/bot.mjs for a grid board rebuilt from a seed and for a finished bot.
- Read the scaffold in INPUT.game_directory and INPUT.existing_games. Choose a game that differs from every existing one.
- Hold the idea against AGENTS.md section 6, "Design checklist for a great game", before you write code.
- Write the pitch, the rules, and the input, snapshot, and round lifecycle contract in the game README first.
- Author public/game.js: the simulation class, the SNAPSHOT schema spec, and the INTENT. Keep the scaffold's export names.
- Draw all randomness from the rng passed to the constructor. Never call Math.random, Date, or a timer in the simulation.
- Treat a missing or zero intent as neutral. Never write to the intents array; the engine freezes it.
- Make the simulation safe with one player, and keep a disconnected seat out of play in disconnect(index).
- Open each round with a short countdown. Advance the tick field on every step, the countdown included.
- Give every moment that needs a sound or a one-shot effect an event field: a players list, or a bool true for one tick.
- Give everything visible for longer than a tick a counter or an age field.
- Keep every snapshot inside the engine's budget of bytes per player per tick. Round positions with a fixed scale.
- Author public/client.js: helpers and cosmetic state, then one startGame call.
- Draw only through the surface passed to draw. Bind the keyboard for every INTENT field.
- Read one-shot effects from ctx.events(field). Never read an event list from the snapshot inside draw.
- Use ctx.time() and ctx.dt() for cosmetic animation, and reset cosmetic state in onRound.
- Mark the local player on the canvas by shape, every frame. Label the other players by name.
- Write ctx.hud for every state: spectator, round over as host, round over as guest, eliminated, and playing.
- Map every event to a sound from the list in "Sound". Use only: "me" for the player's own events and a pitch function for rising stakes.
- Return live rows from the scoreboard hook: alive, state, and note from the snapshot.
- Write the game's own labels. Set nextKey to "Enter" when Space is an action in the game.
- Decide the game's visual identity before you style anything, and record it in the README:
  a palette, a typeface stack, a layout, a tone for the lobby copy, and a canvas art direction that fit the theme.
- Author public/index.html: the markup and every line of copy are yours. Follow INPUT.visual_identity.keep.
- Keep the import map byte for byte, the one module script, the /style.css link, and a link to the superapp.
- Keep each data-engine role exactly once. Rearrange, wrap, and reword the elements that carry them as the design needs.
- Give every INTENT field a touch control in the page: a button, data-engine-touch="<INTENT field>=<number>",
  or a thumb stick for two fields, data-engine-stick="<x field>,<y field>", with a child element as the knob.
- Position the knob from the --stick-x and --stick-y properties, as the scaffold's stylesheet does.
- Author public/style.css from a blank file for this game. The scaffold's theme is a placeholder, not a base.
- Choose the palette, typography, spacing, borders, and motion yourself. No two games in this repository look alike.
- Pass startGame a palette of eight player colours that belong to your theme, and draw the canvas in the same language.
- Keep the page usable at 360 px wide, keep [hidden] { display: none !important; }, and keep text readable on its background.
- Show touch controls only under [data-touch="on"]. Leave the arena's width and aspect ratio to the engine.
- Give the arena's parent a definite width, and keep the scaffold's max-width rule that fits the board to the viewport height.
- Size actors for a phone: one arena unit is under a third of a pixel there. Keep sentences in the page, not on the canvas.
- Style the scoreboard rows the engine writes: li.you, li.dead, li[data-state], and span.note.
- Write at least two scenario tests for your rules in the scaffold's test file, next to the engine checks it already holds.
- Keep the scaffold's one-player test, and adapt it to your INTENT.
- Make test/reference.mjs script your INTENT fields, then run INPUT.record_fixture after every rule change.
- Rewrite test/bot.mjs for your game: its default export is (snapshot, info) => keys to hold, as "Bots" in engine/README.md states.
- Keep the bot one self-contained module with no import. Use info.game for the exports of public/game.js.
- Update game-entry.json with the display name, a one-sentence description, and the player range.
- Follow INPUT.registration_contract and document its deployment command in the README.
- Run every command in INPUT.checks from the repository root and fix each failure before you finish.
- Edit only INPUT.editable_paths. Leave INPUT.coordinator_owned_paths byte-for-byte unchanged.
- Put temporary check scripts under /tmp and run those files with node.
- Leave commits, pushes, pull requests, and deployment to the coordinator.
- Do not read credentials or change Git configuration.

NOTES
Use the game's README as the shared notebook.
Record actual checks and leave browser and production checks marked pending.
The engine owns behaviour: the server, lobby logic, invite link, auto-create, auto-join, transport, and interpolation.
The game owns its page and its stylesheet. The engine binds to the data-engine roles and injects no theme.
The engine shows and hides elements with the hidden attribute. Never toggle them yourself.
Do not write netcode, DOM lobby code, an inline script, or a second import of the engine.
Use the system font stacks of "Typography" only. The page loads no font, image, stylesheet, or script from another origin.
Static conformance fails the origin row for any absolute URL in index.html, style.css, or a script.
The engine delivers each event to ctx.events exactly once on every peer, and plays each mapped sound once.
The engine marks the local player's score row and seats a late joiner in the next match.
The coordinator rejects a page that loses the import map, the module script, the superapp link, or a required role.
The coordinator rejects a style.css that is byte-identical to the scaffold's, and a page that keeps the placeholder copy.
A touch button that names a field outside INTENT fails the static conformance slots row.
Import the engine only through the scaffold's "@engine/" specifier. Its pinned version is INPUT.engine.pin.
The coordinator rejects a game whose simulation misses a method, whose schema does not compile,
whose snapshot exceeds the budget, whose fixture does not replay, or whose static conformance fails.
The first check in INPUT.checks is that same gate. Its rejection names the reason.
The job has no browser. The full conformance tier, scripts/play.mjs, and gameplay stay pending for the reviewer.
The reviewer plays the game with test/bot.mjs. The coordinator checks only its syntax, so read it against your snapshot fields and key bindings.
A bot left as the scaffold wrote it reads fields your snapshot does not have, and the reviewer's run fails.
Because you cannot look at the game, check these yourself before you finish, and record the result in the README:
every INTENT field has a key binding and a touch control; every event field has a sound and, where it matters, an effect;
draw handles ctx.seat() of -1 and a snapshot of any player count from 1 to 8; ctx.hud covers every state;
no element in style.css has a fixed width above 328 px; every colour pair of text and background has clear contrast;
the eight palette colours all read on the canvas background; nothing differs by red against green alone;
each item of AGENTS.md section 6 holds, or the README says why it does not apply.
Simulate a full match in a /tmp script with scripted intents and assert that rounds end, scores move, and a winner emerges.
The root superapp reads public/games.json, not automation/daily-game/catalog.json.
The coordinator adds your metadata to both catalogs and adds the root upload exclusion.
The root entry has url: null until deployment reads the actual URL from Wasmer.
The job contains Bash, Git, Python, and Edge.js as node. It has no npm, rg, or which.
Run a test file directly with node. Use node -e for inline scripts; stdin scripts enter Edge.js's REPL.
The scaffold is untracked, so git diff does not show your edits.

OUTPUT
End the run with a final answer: one JSON object with name, mechanics, checks,
and pending fields. The JSON object is the last thing you write. Add no prose
before or after it.
