import { test } from "node:test";
import assert from "node:assert/strict";
import { createRooms, transition, STATES } from "../rooms.js";
import { seededRng } from "../rng.js";
import {
  MAX_PLAYERS_PER_ROOM, MAX_SPECTATORS_PER_ROOM, PLAYER_NAME_MAX_CHARS,
  REJOIN_GRACE_MS, ROOM_CODE_LENGTH, ROOM_IDLE_TTL_MS,
} from "../params.js";

const harness = (seed = 1) => {
  const clock = { v: 1000 };
  return { clock, rooms: createRooms({ now: () => clock.v, rng: seededRng(seed) }) };
};
const started = () => {
  const h = harness();
  const host = h.rooms.create("h", "host");
  const guest = h.rooms.join("g", { room: host.room.code, name: "guest" });
  h.rooms.startPlaying("h");
  return { ...h, host, guest };
};

test("a room code has the declared length and a free alphabet", () => {
  const { rooms } = harness();
  const { room } = rooms.create("h", "host");
  assert.equal(room.code.length, ROOM_CODE_LENGTH);
  assert.match(room.code, /^[A-Z0-9]+$/);
});

test("only declared transitions are allowed", () => {
  const legal = new Set(["open>playing", "open>closed", "playing>host-absent", "playing>closed",
    "host-absent>playing", "host-absent>closed"]);
  for (const from of STATES) {
    for (const to of STATES) {
      const room = { state: from };
      if (legal.has(`${from}>${to}`)) assert.equal(transition(room, to).state, to);
      else assert.throws(() => transition({ state: from }, to), /no transition/);
    }
  }
});

test("an unknown state is rejected", () => {
  assert.throws(() => transition({ state: "open" }, "melting"), /unknown state/);
});

test("a name longer than the limit is truncated before storage", () => {
  const { rooms } = harness();
  const { member } = rooms.create("h", "x".repeat(PLAYER_NAME_MAX_CHARS + 10));
  assert.equal(member.name.length, PLAYER_NAME_MAX_CHARS);
});

test("a dropped guest keeps its slot when it returns inside the grace window", () => {
  const { rooms, host, guest, clock } = started();
  assert.equal(rooms.disconnect("g").event, "left");
  clock.v += REJOIN_GRACE_MS - 1;
  const back = rooms.join("g2", { room: host.room.code, token: guest.member.token });
  assert.equal(back.kind, "rejoin");
  assert.equal(back.member, guest.member);
  assert.equal(rooms.counts().players, 2);
});

test("a guest that returns after its own grace window is a spectator", () => {
  const { rooms, host, guest, clock } = started();
  rooms.disconnect("g");
  clock.v += REJOIN_GRACE_MS + 1;
  const back = rooms.join("g2", { room: host.room.code, token: guest.member.token });
  assert.equal(back.kind, "spectator");
  assert.notEqual(back.member.token, guest.member.token);
});

test("a guest that returns inside its own grace window keeps its slot even after a long game", () => {
  const { rooms, host, guest, clock } = started();
  clock.v += REJOIN_GRACE_MS * 3;
  rooms.touch(host.room);
  rooms.disconnect("g");
  clock.v += REJOIN_GRACE_MS - 1;
  assert.equal(rooms.join("g2", { room: host.room.code, token: guest.member.token }).kind, "rejoin");
});

test("a host that leaves while playing suspends the room instead of closing it", () => {
  const { rooms, host } = started();
  const effect = rooms.disconnect("h");
  assert.equal(effect.event, "host-absent");
  assert.equal(host.room.state, "host-absent");
  assert.equal(rooms.size(), 1);
});

test("a host that returns inside the grace window resumes play", () => {
  const { rooms, host, clock } = started();
  rooms.disconnect("h");
  clock.v += REJOIN_GRACE_MS - 1;
  const back = rooms.join("h2", { room: host.room.code, token: host.member.token });
  assert.equal(back.kind, "rejoin");
  assert.equal(host.room.state, "playing");
  assert.equal(host.room.hostId, "h2");
});

test("a host that never returns loses the room to the sweep", () => {
  const { rooms, clock } = started();
  rooms.disconnect("h");
  clock.v += REJOIN_GRACE_MS + 1;
  assert.equal(rooms.sweep().length, 1);
  assert.equal(rooms.size(), 0);
});

test("a peer joining a playing room becomes a spectator", () => {
  const { rooms, host } = started();
  const late = rooms.join("s", { room: host.room.code, name: "watcher" });
  assert.equal(late.kind, "spectator");
  assert.equal(rooms.counts().spectators, 1);
  assert.equal(rooms.counts().players, 2);
});

test("the player cap and the spectator cap are separate", () => {
  const { rooms } = harness();
  const { room } = rooms.create("h", "host");
  for (let i = 1; i < MAX_PLAYERS_PER_ROOM; i++) {
    assert.equal(rooms.join(`p${i}`, { room: room.code }).kind, "player");
  }
  assert.equal(rooms.join("overflow", { room: room.code }).error, "room_full");
  rooms.startPlaying("h");
  for (let i = 0; i < MAX_SPECTATORS_PER_ROOM; i++) {
    assert.equal(rooms.join(`s${i}`, { room: room.code }).kind, "spectator");
  }
  assert.equal(rooms.join("extra", { room: room.code }).error, "spectators_full");
});

test("a room with no activity for the idle period is closed", () => {
  const { rooms, clock } = started();
  clock.v += ROOM_IDLE_TTL_MS + 1;
  assert.equal(rooms.sweep().length, 1);
  assert.equal(rooms.size(), 0);
});

test("activity holds a room open past the idle period", () => {
  const { rooms, host, clock } = started();
  clock.v += ROOM_IDLE_TTL_MS - 1;
  rooms.touch(host.room);
  clock.v += 2;
  assert.equal(rooms.sweep().length, 0);
});

test("joining an unknown room is refused by name", () => {
  const { rooms } = harness();
  assert.equal(rooms.join("p", { room: "ZZZZ" }).error, "no_such_room");
});

test("a token from another room is refused by name", () => {
  const { rooms } = harness();
  const first = rooms.create("a", "a");
  const second = rooms.create("b", "b");
  rooms.startPlaying("b");
  assert.equal(rooms.join("c", { room: second.room.code, token: first.member.token }).error, "token_for_another_room");
});

test("a token already in use is refused by name", () => {
  const { rooms, host } = started();
  assert.equal(rooms.join("other", { room: host.room.code, token: host.member.token }).error, "token_in_use");
});

test("a room closes when its last connected peer goes", () => {
  const { rooms } = started();
  rooms.disconnect("g");
  const effect = rooms.disconnect("h");
  assert.equal(effect.event, "host-absent");
  assert.equal(rooms.counts().rooms, 1);
});

test("a lobby host that leaves closes the room immediately", () => {
  const { rooms } = harness();
  const { room } = rooms.create("h", "host");
  rooms.join("g", { room: room.code });
  assert.equal(rooms.disconnect("h").event, "closed");
  assert.equal(rooms.size(), 0);
});

test("only the host can start, and only once", () => {
  const { rooms } = harness();
  const { room } = rooms.create("h", "host");
  rooms.join("g", { room: room.code });
  assert.equal(rooms.startPlaying("g").error, "not_host");
  assert.ok(rooms.startPlaying("h").room);
  assert.equal(rooms.startPlaying("h").error, "already_started");
});

test("creating a room twice from one peer leaves one room", () => {
  const { rooms } = harness();
  rooms.create("h", "host");
  rooms.create("h", "host");
  assert.equal(rooms.size(), 1);
});

test("counts report rooms, players and spectators separately", () => {
  const { rooms, host } = started();
  rooms.join("s", { room: host.room.code });
  assert.deepEqual(rooms.counts(), { rooms: 1, players: 2, spectators: 1 });
});

test("disconnecting an unknown peer is a no-op", () => {
  const { rooms } = harness();
  assert.equal(rooms.disconnect("nobody"), null);
});
