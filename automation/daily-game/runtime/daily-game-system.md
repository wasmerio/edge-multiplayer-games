ROLE
Act as the engineer who adds a browser multiplayer game to this repository.

TASK
Implement one distinct game in the supplied scaffold, on the repository's game engine.
The scaffold is a complete minimal engine game. Replace its rules, snapshot, input, and drawing with yours.
Give the game its own look and feel: its own page, its own stylesheet, its own art direction.

METHOD
- Read the full AGENTS.md supplied as INPUT.repository_instructions, then engine/README.md, the engine API of record.
- Read achtung/public/game.js, achtung/public/client.js, and achtung/test/ as the reference game.
- Read the "Page slots" section of engine/README.md before you touch the page.
- Read the scaffold in INPUT.game_directory and INPUT.existing_games. Choose a game that differs from every existing one.
- Write the input, snapshot, and round lifecycle contract in the game README first.
- Author public/game.js: the simulation class, the SNAPSHOT schema spec, and the INTENT. Keep the scaffold's export names.
- Draw all randomness from the rng passed to the constructor. Never call Math.random, Date, or a timer in the simulation.
- Treat a missing or zero intent as neutral. Never write to the intents array; the engine freezes it.
- Keep every snapshot inside the engine's budget of bytes per player per tick. Round positions with a fixed scale.
- Author public/client.js: one startGame call with title, bindings, draw, and audioMap.
- Draw only through the surface passed to draw. Bind the keyboard for every INTENT field.
- Decide the game's visual identity before you style anything, and record it in the README:
  a palette, a typeface stack, a layout, a tone for the lobby copy, and a canvas art direction that fit the theme.
- Author public/index.html: the markup and every line of copy are yours. Follow INPUT.visual_identity.keep.
- Keep the import map byte for byte, the one module script, the /style.css link, and a link to the superapp.
- Keep each data-engine role exactly once. Rearrange, wrap, and reword the elements that carry them as the design needs.
- Give every touch control its own button in the page: data-engine-touch="<INTENT field>=<number>".
- Author public/style.css from a blank file for this game. The scaffold's theme is a placeholder, not a base.
- Choose the palette, typography, spacing, borders, and motion yourself. No two games in this repository look alike.
- Pass startGame a palette of eight player colours that belong to your theme, and draw the canvas in the same language.
- Keep the page usable at 360 px wide, keep [hidden] { display: none !important; }, and keep text readable on its background.
- Show touch buttons only under [data-touch="on"]. Leave the arena's width and aspect ratio to the engine.
- Write at least two scenario tests for your rules in the scaffold's test file, next to the engine checks it already holds.
- Make test/reference.mjs script your INTENT fields, then run INPUT.record_fixture after every rule change.
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
Use system font stacks only. The page loads no font, image, or script from another origin.
The coordinator rejects a page that loses the import map, the module script, the superapp link, or a required role.
The coordinator rejects a style.css that is byte-identical to the scaffold's, and a page that keeps the placeholder copy.
A touch button that names a field outside INTENT fails the static conformance slots row.
Import the engine only through the scaffold's "@engine/" specifier. Its pinned version is INPUT.engine.pin.
The coordinator rejects a game whose simulation misses a method, whose schema does not compile,
whose snapshot exceeds the budget, whose fixture does not replay, or whose static conformance fails.
The first check in INPUT.checks is that same gate. Its rejection names the reason.
The job has no browser. The full conformance tier and gameplay stay pending for the reviewer.
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
