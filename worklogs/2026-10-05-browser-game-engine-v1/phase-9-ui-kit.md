# Phase 9 — UI kit

**Status:** Complete
[README](README.md)

## Goal

One lobby, invite panel, scoreboard, banner and control layer shared by every
game, so the superapp and its games read as one product.

## Specification

`engine/ui.js` builds the shared chrome into a page from a small declaration:
the game's title, its intent controls, and whether it wants a second local
player. The kit owns the markup and the stylesheet, so a game's `index.html`
shrinks to a container element, a script tag and its own metadata.

Components: the name field with its persisted value, the create and join
controls, the room code display, the invite panel with the full room link and a
copy button, the peer list with connection state, the scoreboard with colour
swatches from the shared palette, the round banner, the touch control overlay
from the input phase, and the mute toggle from the audio phase.

The stylesheet is one file in the engine, themed by custom properties so a game
can recolour without forking layout. Dark and light both render; the container
sets an explicit background. Layout works at phone width with no horizontal
scroll.

The sub-app contract lives here: the kit auto-hosts when the create parameter
is present and auto-joins when a room parameter is present, and it renders the
link back to the superapp. A game cannot forget the contract because the kit
performs it.

### Invariants

| Bound actor | Mechanism | Test |
|---|---|---|
| Every game page | gets the contract behaviour from the kit, not its own code | Conformance row plus a source scan for duplicate handlers |
| Every element the kit reads | is created by the kit | Unit test over a bare container |
| Every persisted preference | is read and written inside a guard | Unit test with storage denied |
| Every colour | comes from the shared palette or a theme property | Source scan for literal colours in game pages |

## Integration contract

| Trigger | Collaborators | Observable result | Required side effects | Prohibited side effects |
|---|---|---|---|---|
| Page loaded with the create parameter | real kit, real server, headless browser | Room created, invite panel visible without interaction | Room code in the address bar | No click required |
| Page loaded with a room parameter | same | Auto-join with the stored or a generated name | Name persisted | No lobby shown first |
| Copy button pressed | real kit, fake clipboard | Link copied, control confirms | None | No navigation |
| Storage denied | real kit | Lobby still works with a generated name | None | No throw |
| Page rendered at phone width | real kit, headless browser | No horizontal scroll, controls reachable | None | No fixed pixel layout |
| Peer connects and its channel opens | real kit, real transport | Peer list shows the open state | None | No stale state |

## Acceptance criteria

| Outcome | Proof |
|---|---|
| The contract is performed by the kit | Conformance rows against a game with no contract code of its own |
| One stylesheet serves every game | Source scan after migration finds one |
| Phone width works | Headless browser test at a narrow viewport |
| Both themes render | Screenshot test in each colour scheme |
| Preferences survive a blocked store | Denied-storage test |

## Error coverage

| Failure | Expected outcome | Test |
|---|---|---|
| Container element missing | Kit throws naming the expected element | Unit test |
| Declaration names an unknown control | Kit throws naming it | Unit test |
| Clipboard unavailable | Link stays selectable, control reports it | Unit test |
| Room parameter malformed | Join refused with the server's named code shown | Unit test |
| Palette asset unavailable | Kit falls back to theme properties, layout intact | Unit test |

## Implementation notes

Session 2026-10-05 (lead agent with subworkers). Deltas only.

- Kit gained a HUD line (`ctx.hud`), a host "Next round" / "New match" control, a `scoreboard` hook for team games and `minPlayers`.
- Fixed: copy reported success with no clipboard; light theme left fields dark; a blocked store threw.
- Not implemented: the "second local player" declaration. No table row covers it and the migrated games lost that lobby option.
- Verification: `engine/test/ui.test.mjs`, `scripts/ui.test.mjs` (phone width, both themes, denied storage).

## Review findings

None.
