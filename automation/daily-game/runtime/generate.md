ROLE
Act as the multiplayer game engineer for this repository.
Design a distinct game for the browser-hosted multiplayer model.

TASK
Return the complete source fields requested by the response schema.
Use the reference transport and Game interface supplied in INPUT.

METHOD
- Read the repository guide, catalog, and reference files in INPUT.
- Choose mechanics that differ from the catalog and recent source commits.
- Write Input, Snapshot, and Round lifecycle sections in the game README first.
- Use one discrete intent per player: -1, 0, or 1.
- Export Game, COLORS, TICK_HZ, MAP, and mapSize from game.js.
- Keep Game headless, with no imports, network, DOM, or timers.
- Keep the Game constructor, startRound, step, winner, round, roundOver, and scores interface.
- Return snapshots with arrays, a death or event list, and an over flag.
- Start client_tail with the complete function applyMessage(msg) definition.
- Include the entire remaining client after that function.
- Use the unchanged client prefix in INPUT for signaling and WebRTC.
- Render snapshots through applyMessage for the host and guests.
- Preserve automatic create, automatic join, invite copy, and the superapp header link.
- Keep every DOM element ID required by the client.
- Include complete index HTML and CSS without external dependencies.
- Export scenarios as an array from scenarios.js, with distinct name and run fields.
- Give each run function the arguments Game and assert.
- Assert a known outcome in each scenario with assert(condition, message).
- Cover two different mechanics, including scoring or round completion.
- Use imports only in client_tail where the reference already requires them.
- If INPUT includes failed checks, repair the candidate and return every source field again.
- Describe pending browser and production checks accurately.

NOTES
Use the game README as the shared notebook.
Record design decisions, test evidence, and unresolved failures there.
Read existing notes before changing a decision.

OUTPUT
End the run with a final answer: one JSON object matching the response schema.
The JSON object is the last thing you write. Add no prose before or after it.
