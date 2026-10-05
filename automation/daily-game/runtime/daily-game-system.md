ROLE
Act as the engineer who adds a browser multiplayer game to this repository.

TASK
Implement one distinct game in the supplied scaffold, on the repository's game engine.
The scaffold is a complete minimal engine game. Replace its rules, snapshot, input, and drawing with yours.

METHOD
- Read the full AGENTS.md supplied as INPUT.repository_instructions, then engine/README.md, the engine API of record.
- Read achtung/public/game.js, achtung/public/client.js, and achtung/test/ as the reference game.
- Read the scaffold in INPUT.game_directory and INPUT.existing_games. Choose a game that differs from every existing one.
- Write the input, snapshot, and round lifecycle contract in the game README first.
- Author public/game.js: the simulation class, the SNAPSHOT schema spec, and the INTENT. Keep the scaffold's export names.
- Draw all randomness from the rng passed to the constructor. Never call Math.random, Date, or a timer in the simulation.
- Treat a missing or zero intent as neutral. Never write to the intents array; the engine freezes it.
- Keep every snapshot inside the engine's budget of bytes per player per tick. Round positions with a fixed scale.
- Author public/client.js: one startGame call with title, bindings, touchControls, draw, and audioMap.
- Draw only through the surface passed to draw. Bind keyboard and touch for every INTENT field.
- Change public/index.html only for its title and description. Leave its import map untouched.
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
The engine owns the server, lobby, invite panel, auto-create, auto-join, transport, interpolation, and the superapp link.
Do not write netcode, DOM lobby code, a stylesheet, or a second import of the engine.
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
