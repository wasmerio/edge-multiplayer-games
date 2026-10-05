// Phase 3 evidence: room-lifecycle rows proven on the registry alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRooms } from "../rooms.js";
import { seededRng } from "../rng.js";
import {
  MAX_PLAYERS_PER_ROOM, MAX_SPECTATORS_PER_ROOM, PLAYER_NAME_MAX_CHARS, REJOIN_GRACE_MS, ROOM_IDLE_TTL_MS,
} from "../params.js";

const harness = () => {
  const clock = { v: 1000 };
  return { clock, rooms: createRooms({ now: () => clock.v, rng: seededRng(1) }) };
};
const started = () => {
  const h = harness();
  const host = h.rooms.create("h", "host");
  const guest = h.rooms.join("g", { room: host.room.code, name: "guest" });
  h.rooms.startPlaying("h");
  return { ...h, host, guest, room: host.room };
};
// The host identity is the member that is the host now, or the absent one that may reclaim it.
const hostIdentities = (room) => [...room.members.values()].filter((m) => m.peerId === room.hostId || m.wasHost === true);

test("the room state is written in one place, inside transition()", () => {
  const strip = (source) => source.replace(/\/\/.*$/gm, "");
  const rooms = strip(fs.readFileSync(new URL("../rooms.js", import.meta.url), "utf8"));
  const writes = rooms.match(/\.state\s*=(?!=)/g) || [];
  assert.equal(writes.length, 1, "rooms.js assigns a room state once");
  assert.match(rooms, /if \(!EDGES\[room\.state\]\.includes\(next\)\) \{\s*throw [^\n]*\s*\}\s*room\.state = next;/);
  const server = strip(fs.readFileSync(new URL("../server.js", import.meta.url), "utf8"));
  assert.equal((server.match(/\.state\s*=(?!=)/g) || []).length, 0, "server.js never assigns a room state");
});

test("a room has exactly one host identity in every state it passes through", () => {
  const { rooms, clock } = harness();
  const host = rooms.create("h", "host");
  const { room } = host;
  const guest = rooms.join("g", { room: room.code, name: "guest" });
  rooms.join("other", { room: room.code, name: "other" });
  rooms.startPlaying("h");
  const seen = [];
  const check = (label) => {
    seen.push(room.state);
    assert.equal(hostIdentities(room).length, 1, `${label}: ${room.state}`);
  };
  check("playing");
  rooms.disconnect("h");
  check("host away");
  assert.equal(hostIdentities(room)[0], host.member);

  // A guest that drops and returns while the host is away must not inherit the room.
  rooms.disconnect("g");
  const guestBack = rooms.join("g2", { room: room.code, token: guest.member.token });
  assert.equal(guestBack.kind, "rejoin");
  check("guest back first");
  assert.equal(hostIdentities(room)[0], host.member);
  assert.equal(room.state, "host-absent", "only the host's return resumes play");
  assert.notEqual(room.hostId, "g2");

  clock.v += REJOIN_GRACE_MS - 1;
  rooms.join("h2", { room: room.code, token: host.member.token });
  check("host back");
  assert.equal(room.hostId, "h2");
  assert.equal(host.member.peerId, "h2");

  rooms.disconnect("h2");
  check("host away again");
  clock.v += REJOIN_GRACE_MS + 1;
  rooms.sweep();
  seen.push(room.state);
  assert.deepEqual(seen, ["playing", "host-absent", "host-absent", "playing", "host-absent", "closed"]);
});

test("a lobby room has one host from creation and a joining guest never becomes it", () => {
  const { rooms } = harness();
  const { room, member } = rooms.create("h", "host");
  assert.deepEqual(hostIdentities(room), [member]);
  rooms.join("g", { room: room.code });
  assert.deepEqual(hostIdentities(room), [member]);
});

test("join path: a fresh join of an open room stops at the player cap", () => {
  const { rooms } = harness();
  const { room } = rooms.create("h", "host");
  for (let i = 1; i < MAX_PLAYERS_PER_ROOM; i++) assert.equal(rooms.join(`p${i}`, { room: room.code }).kind, "player");
  assert.equal(rooms.join("extra", { room: room.code }).error, "room_full");
  assert.equal(rooms.players(room).length, MAX_PLAYERS_PER_ROOM);
  assert.equal(rooms.spectators(room).length, 0);
});

for (const state of ["playing", "host-absent"]) {
  test(`join path: a fresh join of a ${state} room stops at the spectator cap and leaves the players alone`, () => {
    const { rooms, room } = started();
    if (state === "host-absent") rooms.disconnect("h");
    assert.equal(room.state, state);
    for (let i = 0; i < MAX_SPECTATORS_PER_ROOM; i++) assert.equal(rooms.join(`s${i}`, { room: room.code }).kind, "spectator");
    assert.equal(rooms.join("extra", { room: room.code }).error, "spectators_full");
    assert.equal(rooms.players(room).length, 2);
    assert.equal(rooms.spectators(room).length, MAX_SPECTATORS_PER_ROOM);
  });
}

test("join path: a rejoin by token allocates nothing, even with both caps reached", () => {
  const { rooms } = harness();
  const { room } = rooms.create("h", "host");
  const seats = [];
  for (let i = 1; i < MAX_PLAYERS_PER_ROOM; i++) seats.push(rooms.join(`p${i}`, { room: room.code }));
  rooms.startPlaying("h");
  for (let i = 0; i < MAX_SPECTATORS_PER_ROOM; i++) rooms.join(`s${i}`, { room: room.code });
  rooms.disconnect("p1");
  const back = rooms.join("p1b", { room: room.code, token: seats[0].member.token });
  assert.equal(back.kind, "rejoin");
  assert.equal(back.member, seats[0].member);
  assert.equal(room.members.size, MAX_PLAYERS_PER_ROOM + MAX_SPECTATORS_PER_ROOM);
  assert.equal(rooms.players(room).length, MAX_PLAYERS_PER_ROOM);
});

test("join path: an expired token is a fresh join and meets the spectator cap like any other", () => {
  const { rooms, room, guest, clock } = started();
  rooms.disconnect("g");
  clock.v += REJOIN_GRACE_MS + 1;
  rooms.touch(room);
  for (let i = 0; i < MAX_SPECTATORS_PER_ROOM; i++) rooms.join(`s${i}`, { room: room.code });
  assert.equal(rooms.join("late", { room: room.code, token: guest.member.token }).error, "spectators_full");
  assert.equal(guest.member.connected, false, "the old slot is not resurrected");
});

test("a name is truncated on the join path too, and an empty one gets a placeholder", () => {
  const { rooms } = harness();
  const { room } = rooms.create("h", "host");
  const long = rooms.join("g", { room: room.code, name: "y".repeat(PLAYER_NAME_MAX_CHARS * 3) });
  assert.equal(long.member.name, "y".repeat(PLAYER_NAME_MAX_CHARS));
  assert.equal(rooms.join("n", { room: room.code, name: "" }).member.name, "anon");
  rooms.startPlaying("h");
  const watcher = rooms.join("s", { room: room.code, name: "z".repeat(PLAYER_NAME_MAX_CHARS + 1) });
  assert.equal(watcher.member.name.length, PLAYER_NAME_MAX_CHARS);
});

test("a token no room knows is treated as a fresh join", () => {
  const { rooms } = harness();
  const { room } = rooms.create("h", "host");
  const fresh = rooms.join("g", { room: room.code, name: "guest", token: "never-issued" });
  assert.equal(fresh.kind, "player");
  assert.notEqual(fresh.member.token, "never-issued");
  assert.equal(rooms.players(room).length, 2);
});

test("a token offered to a room that does not exist is refused by name, never matched elsewhere", () => {
  const { rooms } = harness();
  const { member } = rooms.create("h", "host");
  assert.equal(rooms.join("g", { room: "ZZZZ", token: member.token }).error, "no_such_room");
  assert.equal(member.connected, true);
});

test("no deadline survives a closed room, whichever way it closed", () => {
  const byGrace = started();
  byGrace.rooms.disconnect("h");
  assert.equal(byGrace.room.graceUntil, byGrace.clock.v + REJOIN_GRACE_MS);
  byGrace.clock.v += REJOIN_GRACE_MS + 1;
  assert.deepEqual(byGrace.rooms.sweep(), [byGrace.room]);
  assert.equal(byGrace.room.state, "closed");
  assert.equal(byGrace.room.graceUntil, null);

  const byIdle = started();
  byIdle.clock.v += ROOM_IDLE_TTL_MS + 1;
  byIdle.rooms.sweep();
  assert.equal(byIdle.room.graceUntil, null);

  const byLeaving = started();
  byLeaving.rooms.disconnect("h");
  byLeaving.rooms.disconnect("g");
  for (const h of [byGrace, byIdle]) {
    assert.equal(h.rooms.size(), 0);
    assert.equal(h.rooms.roomOf("h"), undefined);
    assert.equal(h.rooms.roomOf("g"), undefined);
    h.clock.v += ROOM_IDLE_TTL_MS * 10;
    assert.deepEqual(h.rooms.sweep(), [], "a closed room is never swept again");
  }
});

test("a host that returns after the room closed gets a fresh room and no old slot", () => {
  const { rooms, room, host, guest, clock } = started();
  rooms.disconnect("h");
  clock.v += REJOIN_GRACE_MS + 1;
  rooms.sweep();
  assert.equal(rooms.join("h2", { room: room.code, token: host.member.token }).error, "no_such_room");

  const again = rooms.create("h2", "host");
  assert.notEqual(again.room, room);
  assert.equal(again.room.state, "open");
  assert.notEqual(again.member, host.member);
  assert.notEqual(again.member.token, host.member.token);
  assert.deepEqual([...again.room.members.keys()], ["h2"]);
  assert.equal(rooms.join("g2", { room: again.room.code, token: guest.member.token }).kind, "player", "an old seat token buys nothing");
  assert.equal(room.state, "closed");
});
