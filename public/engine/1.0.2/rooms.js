// Room lifecycle, with no socket in sight so every edge is unit-testable.
// Losing the host suspends a room for the grace window; the DataChannels that
// are already open keep the game alive while the host reloads.
import {
  MAX_PLAYERS_PER_ROOM, MAX_SPECTATORS_PER_ROOM, PLAYER_NAME_MAX_CHARS,
  REJOIN_GRACE_MS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_IDLE_TTL_MS,
} from "./params.js";

export const STATES = ["open", "playing", "host-absent", "closed"];
const EDGES = {
  open: ["playing", "closed"],
  playing: ["host-absent", "closed"],
  "host-absent": ["playing", "closed"],
  closed: [],
};

export function transition(room, next) {
  if (!STATES.includes(next)) throw new Error(`rooms: unknown state ${next}`);
  if (!EDGES[room.state].includes(next)) {
    throw new Error(`rooms: no transition from ${room.state} to ${next}`);
  }
  room.state = next;
  return room;
}

const clean = (name) => String(name ?? "anon").slice(0, PLAYER_NAME_MAX_CHARS) || "anon";

export function createRooms({ now, rng }) {
  const rooms = new Map();
  const byPeer = new Map();

  const code = () => {
    for (;;) {
      let value = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) value += rng.pick([...ROOM_CODE_ALPHABET]);
      if (!rooms.has(value)) return value;
    }
  };
  const token = () => `${rng.int(0, 0xffffff).toString(36)}${rng.int(0, 0xffffff).toString(36)}`;
  const touch = (room) => { room.lastActivity = now(); };

  const players = (room) => [...room.members.values()].filter((m) => !m.spectator);
  const spectators = (room) => [...room.members.values()].filter((m) => m.spectator);

  function create(peerId, name) {
    detach(peerId);
    const value = code();
    const room = {
      code: value, state: "open", hostId: peerId,
      members: new Map(), lastActivity: now(), graceUntil: null,
    };
    const member = { peerId, name: clean(name), token: token(), spectator: false, connected: true, disconnectedAt: null };
    room.members.set(peerId, member);
    rooms.set(value, room);
    byPeer.set(peerId, value);
    return { room, member };
  }

  function join(peerId, { room: wanted, name, token: offered }) {
    const room = rooms.get(String(wanted ?? "").toUpperCase());
    if (!room || room.state === "closed") return { error: "no_such_room" };
    touch(room);

    if (offered) {
      const existing = [...room.members.values()].find((m) => m.token === offered);
      if (existing) {
        if (existing.connected) return { error: "token_in_use" };
        // Each member carries its own grace window; the room's timer governs
        // only whether the room survives an absent host.
        const expired = existing.disconnectedAt !== null && now() - existing.disconnectedAt > REJOIN_GRACE_MS;
        if (!expired) {
          detach(peerId);
          room.members.delete(existing.peerId);
          existing.peerId = peerId;
          existing.connected = true;
          existing.disconnectedAt = null;
          room.members.set(peerId, existing);
          byPeer.set(peerId, room.code);
          if (existing.wasHost) {
            room.hostId = peerId;
            existing.wasHost = false;
          }
          if (room.state === "host-absent" && room.hostId === peerId) {
            transition(room, "playing");
            room.graceUntil = null;
          }
          return { room, member: existing, kind: "rejoin" };
        }
      }
      const elsewhere = [...rooms.values()].some((r) => r !== room && [...r.members.values()].some((m) => m.token === offered));
      if (elsewhere) return { error: "token_for_another_room" };
    }

    const asSpectator = room.state !== "open";
    if (asSpectator) {
      if (spectators(room).length >= MAX_SPECTATORS_PER_ROOM) return { error: "spectators_full" };
    } else if (players(room).length >= MAX_PLAYERS_PER_ROOM) {
      return { error: "room_full" };
    }
    detach(peerId);
    const member = {
      peerId, name: clean(name), token: token(),
      spectator: asSpectator, connected: true, disconnectedAt: null,
    };
    room.members.set(peerId, member);
    byPeer.set(peerId, room.code);
    return { room, member, kind: asSpectator ? "spectator" : "player" };
  }

  function startPlaying(peerId) {
    const room = roomOf(peerId);
    if (!room) return { error: "no_such_room" };
    if (room.hostId !== peerId) return { error: "not_host" };
    if (room.state !== "open") return { error: "already_started" };
    touch(room);
    return { room: transition(room, "playing") };
  }

  function disconnect(peerId) {
    const room = roomOf(peerId);
    if (!room) return null;
    const member = room.members.get(peerId);
    if (!member) return null;
    byPeer.delete(peerId);

    if (room.state === "open") {
      room.members.delete(peerId);
      if (room.hostId === peerId || room.members.size === 0) return close(room);
      return { room, event: "left", member };
    }

    member.connected = false;
    member.disconnectedAt = now();
    if (room.hostId === peerId) {
      member.wasHost = true;
      room.hostId = undefined;
      room.graceUntil = now() + REJOIN_GRACE_MS;
      transition(room, "host-absent");
      return { room, event: "host-absent", member };
    }
    if ([...room.members.values()].every((m) => !m.connected)) return close(room);
    return { room, event: "left", member };
  }

  function close(room) {
    if (room.state !== "closed") transition(room, "closed");
    room.graceUntil = null;
    for (const member of room.members.values()) byPeer.delete(member.peerId);
    rooms.delete(room.code);
    return { room, event: "closed" };
  }

  function sweep() {
    const closed = [];
    for (const room of [...rooms.values()]) {
      const graceElapsed = room.graceUntil !== null && room.graceUntil !== undefined && now() > room.graceUntil;
      const idle = now() - room.lastActivity > ROOM_IDLE_TTL_MS;
      if (graceElapsed || idle) closed.push(close(room).room);
    }
    return closed;
  }

  const roomOf = (peerId) => rooms.get(byPeer.get(peerId));
  function detach(peerId) {
    const room = roomOf(peerId);
    if (room) disconnect(peerId);
  }

  return {
    create, join, startPlaying, disconnect, sweep, touch, transition,
    roomOf,
    get: (value) => rooms.get(String(value ?? "").toUpperCase()),
    players, spectators,
    counts: () => {
      let p = 0, s = 0;
      for (const room of rooms.values()) { p += players(room).length; s += spectators(room).length; }
      return { rooms: rooms.size, players: p, spectators: s };
    },
    size: () => rooms.size,
  };
}
