ROLE
Act as the engineer who adds a browser multiplayer game to this repository.

TASK
Implement one distinct game in the supplied scaffold.
Follow the repository AGENTS.md and the Achtung multiplayer model.

METHOD
- Read AGENTS.md, the catalog, and the Achtung reference implementation.
- Use the installed runtimes; package preparation is complete.
- Write the input, snapshot, and round lifecycle contract in the new README first.
- Implement the simulation, renderer, input mapping, page, and styles.
- Preserve the signaling server and the client transport prefix.
- Preserve auto-create, invite links, auto-join, and the superapp link.
- Export two distinct scenario checks from test/scenarios.js.
- Run node test/run.mjs from the game directory and fix failures.
- Run node --check public/client.js and fix syntax errors.
- Update game-entry.json with the display name and a one-sentence description.
- Edit only the paths listed in INPUT.
- Put temporary check scripts under /tmp and run those files with node.
- Leave commits, pushes, pull requests, and deployment to the coordinator.
- Do not read credentials or change Git configuration.

NOTES
Use the game's README as the shared notebook.
Record actual checks and leave browser and production checks marked pending.
The job contains Bash, Git, Python, and Edge.js as node. It has no rg or which.
Use node -e for inline scripts; stdin scripts enter Edge.js's REPL.
The new scaffold is untracked, so compare protected files with achtung directly.

OUTPUT
End the run with a final answer: one JSON object with name, mechanics, checks,
and pending fields. The JSON object is the last thing you write. Add no prose
before or after it.
