# Phase 3 — Signaling and room lifecycle

**Status:** Complete
[README](README.md)

## Goal

Move the signaling server into the engine as its single copy, and give rooms a
specified lifecycle: rejoin, host departure, spectating and expiry.

## Specification

`engine/server.js` exports `createServer({ publicDir, hooks })` returning a
Node server with the static handler, the health endpoint and the signaling
socket. A game's `src/server.js` becomes a call to it. The static handler keeps
its traversal guard and its no-store policy for game files.

Room state gains, beyond the current registry: a per-peer durable token issued
on first join, a disconnect timestamp, a spectator set, and a last-activity
timestamp.

### States

| State | Entered when | Exited when |
|---|---|---|
| `open` | Host creates the room | Host starts the game, or the room expires |
| `playing` | Host broadcasts the lobby message | Round sequence ends, or the room expires |
| `host-absent` | Host's socket closes while playing | Host rejoins within the grace window, or the window elapses |
| `closed` | Grace window elapses, or the last peer leaves, or the idle timer fires | Terminal |

A peer that reconnects inside the grace window with a matching token resumes
its player slot and receives the current lobby and round state. A peer that
arrives while the room is `playing` without a token joins the spectator set up
to the spectator cap and receives snapshots but sends no input. Host departure
no longer closes the room immediately; it suspends it for the grace window so
DataChannels that are still open keep the game alive.

The idle timer closes a room whose last activity is older than the idle period.
Activity is any signaling message from any member.

### Invariants

| Bound actor | Mechanism | Test |
|---|---|---|
| Every room transition | goes through one `transition()` function that rejects unknown edges | Unit test enumerating every pair |
| Every room | has exactly one host identity at any time | Unit test over the transition table |
| Every join path | respects the player cap, and the spectator cap separately | Unit test per path |
| Every peer name | truncated to the name limit before storage | Unit test |
| Every timer | cleared when the room closes | Unit test asserting no timer survives |

## Integration contract

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Guest socket closes and reconnects with its token inside the grace window | real server, two real sockets | Guest resumes its slot and receives current state | Disconnect timestamp cleared | No new player slot allocated |
| Guest reconnects after the grace window | same | Guest is admitted as a new peer | New slot or spectator seat | Old slot not resurrected |
| Host socket closes while playing | real server, remaining sockets | Room reports `host-absent`, peers notified, room retained | Grace timer armed | Room not deleted |
| Host does not return | same | Room closes, peers notified | Timers cleared | No further snapshots relayed |
| Peer joins a playing room without a token | real server | Admitted as spectator under the cap | Spectator set grows | Not added to the player list |
| Spectator cap reached | same | Join refused with a named code | None | Player cap unaffected |
| No activity for the idle period | real server, injected clock | Room closes | Timers cleared | Other rooms unaffected |
| Health endpoint queried | real server | Counts rooms, players and spectators | None | No room state mutated |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| One server copy exists | Repository scan finds a single implementation |
| A dropped guest keeps its slot | Rejoin integration scenario |
| A dropped host does not end the game | Host-absent integration scenario |
| Rooms do not leak | Idle-expiry scenario with an injected clock |
| Spectators receive state and send none | Spectator scenario asserting a rejected input |
| Health counts are accurate | Health scenario after a known sequence of joins |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| Malformed signaling payload | Named error code, socket stays open | Unit test |
| Token for an unknown room | Treated as a fresh join | Unit test |
| Token belonging to another room | Refused with a named code | Unit test |
| Join of a full room | Refused with a named code | Unit test |
| Signal addressed to an absent peer | Named error code to the sender only | Unit test |
| Payload above the socket limit | Connection closed by the socket layer | Unit test |
| Host rejoin after the room closed | Treated as a fresh create, no slot resurrected | Unit test |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- `createServer({ publicDir, superappDir, webSocketServer, ... })`: `hooks` from the specification was not needed; `superappDir` is new (D-21) and serves `/engine/**` and `/assets/**` from the superapp tree for local runs.
- A missing `favicon.ico` answers 204, so a page logs no error.
- A peer whose channel opens after Start is welcomed by the host with the lobby, the round and a full snapshot (`host.welcome`), and `need-full` is answered. Before this a late spectator received `snapshot_before_lobby`.
- A signaling `leave` calls the simulation's optional `disconnect(index)`.
- Verification: engine suite; `engine/test/lifecycle.test.mjs` for the late-join rows added this session.
- Evidence audit: rows proven in `engine/test/evidence-rooms.test.mjs` and `evidence-server.test.mjs` (real server, real sockets, the server's own sweep). The audit found and fixed a host-identity defect: with the host absent, a guest rejoining by token was promoted to host. Narrower than specified: a spectator's input is dropped silently rather than refused with a code, and a host returning after close gets `no_such_room` until it sends a fresh `create`. The static handler sends `no-cache`, not `no-store`.

## Review findings

None.
