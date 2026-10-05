// Phase 3 and 4 evidence: integration rows against the real server over real sockets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../server.js";
import {
  MAX_SPECTATORS_PER_ROOM, PROTOCOL_VERSION, REJOIN_GRACE_MS, ROOM_IDLE_TTL_MS, WS_MAX_PAYLOAD_BYTES,
} from "../params.js";

const require = createRequire(new URL("../../achtung/package.json", import.meta.url));
const { WebSocketServer, WebSocket } = require("ws");

const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-evidence-"));
fs.writeFileSync(path.join(publicDir, "index.html"), "<!doctype html>");

async function withServer(run, options = {}) {
  const clock = { v: 1_000_000 };
  const app = createServer({
    publicDir, webSocketServer: WebSocketServer,
    now: () => clock.v, seed: 11, sweepEvery: 1_000_000, ...options,
  });
  const { port } = await app.listen(0, "127.0.0.1");
  const sockets = [];
  const url = `ws://127.0.0.1:${port}/ws`;
  const connect = async () => {
    const p = peer(url);
    sockets.push(p);
    p.ready = await p.expect("ready");
    return p;
  };
  const health = async () => (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
  // A started two-player room: the fixture most rows begin from.
  const playing = async () => {
    const host = await connect();
    host.send({ t: "create", name: "host" });
    const created = await host.expect("created");
    const guest = await connect();
    guest.send({ t: "join", room: created.room, name: "guest" });
    const joined = await guest.expect("joined");
    await host.expect("peer");
    host.send({ t: "start" });
    await host.expect("started");
    await guest.expect("started");
    return { host, guest, created, joined, room: app.rooms.get(created.room) };
  };
  try {
    return await run({ app, clock, connect, health, playing });
  } finally {
    for (const p of sockets) p.socket.terminate();
    await app.close();
  }
}

function peer(url) {
  const socket = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  socket.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    const at = waiters.findIndex((w) => w.kind === msg.t);
    if (at >= 0) waiters.splice(at, 1)[0].resolve(msg); else inbox.push(msg);
  });
  const closed = new Promise((resolve) => socket.on("close", (code) => resolve(code)));
  socket.on("error", () => {});
  const self = {
    socket, inbox, closed,
    send: (msg) => socket.send(JSON.stringify(msg)),
    expect: (kind) => {
      const at = inbox.findIndex((m) => m.t === kind);
      if (at >= 0) return Promise.resolve(inbox.splice(at, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${kind}`)), 3000);
        waiters.push({ kind, resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
      });
    },
    // Everything the server sent before this point has arrived once the pong is back.
    settle: async () => { self.send({ t: "ping" }); await self.expect("pong"); return inbox.map((m) => m.t); },
    close: () => socket.close(),
  };
  return self;
}

test("a guest that reconnects with its token inside the grace window resumes its slot and receives the current state", async () => {
  await withServer(async ({ app, clock, connect, health, playing }) => {
    const { host, guest, created, joined, room } = await playing();
    const seat = room.members.get(joined.id);

    guest.close();
    assert.equal((await host.expect("leave")).id, joined.id);
    assert.equal(seat.connected, false);
    assert.equal(seat.disconnectedAt, clock.v);

    clock.v += REJOIN_GRACE_MS - 1;
    const again = await connect();
    again.send({ t: "join", room: created.room, token: joined.token });
    const rejoined = await again.expect("rejoined");

    assert.equal(rejoined.state, "playing");
    assert.equal(rejoined.host, created.id);
    assert.equal(rejoined.spectator, false);
    assert.equal(rejoined.token, joined.token);
    assert.deepEqual(rejoined.peers.map((p) => [p.name, p.spectator, p.connected]), [["host", false, true], ["guest", false, true]]);
    assert.equal((await host.expect("resumed")).id, again.ready.id);

    assert.equal(seat.disconnectedAt, null, "disconnect timestamp cleared");
    assert.equal(room.members.get(again.ready.id), seat, "the same slot, under the new socket");
    assert.equal(room.members.size, 2, "no new player slot allocated");
    assert.deepEqual(app.rooms.counts(), { rooms: 1, players: 2, spectators: 0 });
    assert.equal((await health()).players, 2);
  });
});

test("a guest that reconnects after the grace window is admitted as a new peer and its old slot stays down", async () => {
  await withServer(async ({ clock, connect, health, playing }) => {
    const { host, guest, created, joined, room } = await playing();
    const seat = room.members.get(joined.id);
    guest.close();
    await host.expect("leave");

    clock.v += REJOIN_GRACE_MS + 1;
    const again = await connect();
    again.send({ t: "join", room: created.room, token: joined.token });
    const admitted = await again.expect("joined");

    assert.equal(admitted.spectator, true, "a playing room seats a new peer as a spectator");
    assert.notEqual(admitted.token, joined.token);
    assert.notEqual(room.members.get(again.ready.id), seat);
    assert.equal(seat.connected, false, "old slot not resurrected");
    assert.equal(seat.peerId, joined.id);
    assert.notEqual(seat.disconnectedAt, null);
    assert.equal((await host.expect("peer")).spectator, true);
    assert.equal((await host.settle()).includes("resumed"), false);
    assert.equal((await health()).spectators, 1);
  });
});

test("a host socket closing mid-game leaves the room host-absent, tells the peers and arms the grace deadline", async () => {
  await withServer(async ({ app, clock, health, playing }) => {
    const { host, guest, created, room } = await playing();
    host.close();
    assert.equal((await guest.expect("host-absent")).id, created.id);
    assert.equal(room.state, "host-absent");
    assert.equal(room.graceUntil, clock.v + REJOIN_GRACE_MS, "grace timer armed");
    assert.equal(app.rooms.get(created.room), room, "room not deleted");
    assert.equal((await guest.settle()).includes("room-closed"), false);
    const body = await health();
    assert.deepEqual([body.rooms, body.players], [1, 2]);
  });
});

test("a host that does not return closes the room through the server's own sweep, and nothing is relayed afterwards", async () => {
  await withServer(async ({ app, clock, connect, health, playing }) => {
    const { host, guest, created, room } = await playing();
    const watcher = await connect();
    watcher.send({ t: "join", room: created.room, name: "watcher" });
    await watcher.expect("joined");

    host.close();
    await guest.expect("host-absent");
    clock.v += REJOIN_GRACE_MS - 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(room.state, "host-absent", "the sweep leaves the room alone inside the window");

    clock.v += 2;
    await guest.expect("room-closed");
    await watcher.expect("room-closed");
    assert.equal(room.state, "closed");
    assert.equal(room.graceUntil, null, "timers cleared");
    assert.equal(app.rooms.size(), 0);
    assert.equal((await health()).rooms, 0);

    guest.send({ t: "signal", to: watcher.ready.id, data: { sdp: "late" } });
    assert.equal((await guest.expect("error")).code, "no_such_room");
    assert.equal((await watcher.settle()).includes("signal"), false, "no further relay");
  }, { sweepEvery: 5 });
});

test("a peer that joins a playing room without a token is a spectator and never a player", async () => {
  await withServer(async ({ app, connect, health, playing }) => {
    const { host, created, room } = await playing();
    const watcher = await connect();
    watcher.send({ t: "join", room: created.room, name: "watcher" });
    const joined = await watcher.expect("joined");
    assert.equal(joined.spectator, true);
    assert.equal(joined.state, "playing");
    assert.equal((await host.expect("peer")).spectator, true);
    assert.deepEqual(app.rooms.spectators(room).map((m) => m.peerId), [joined.id], "spectator set grows");
    assert.equal(app.rooms.players(room).some((m) => m.peerId === joined.id), false, "not added to the player list");
    const body = await health();
    assert.deepEqual([body.players, body.spectators], [2, 1]);
  });
});

test("a join past the spectator cap is refused by name and the players are untouched", async () => {
  await withServer(async ({ app, connect, health, playing }) => {
    const { host, guest, created, joined, room } = await playing();
    for (let i = 0; i < MAX_SPECTATORS_PER_ROOM; i++) {
      const watcher = await connect();
      watcher.send({ t: "join", room: created.room, name: `w${i}` });
      assert.equal((await watcher.expect("joined")).spectator, true);
    }
    const extra = await connect();
    extra.send({ t: "join", room: created.room, name: "extra" });
    assert.equal((await extra.expect("error")).code, "spectators_full");
    assert.equal(extra.socket.readyState, WebSocket.OPEN);
    assert.equal(room.members.size, 2 + MAX_SPECTATORS_PER_ROOM, "nothing was allocated for the refused peer");
    const body = await health();
    assert.deepEqual([body.players, body.spectators], [2, MAX_SPECTATORS_PER_ROOM]);

    // The player cap is its own count: a dropped player still gets its seat back.
    guest.close();
    await host.expect("leave");
    const back = await connect();
    back.send({ t: "join", room: created.room, token: joined.token });
    assert.equal((await back.expect("rejoined")).spectator, false);
    assert.equal(app.rooms.players(room).length, 2);
  });
});

test("a room idle for the idle period is closed by the server's sweep while an active room stays", async () => {
  await withServer(async ({ app, clock, connect, health }) => {
    const quiet = await connect();
    quiet.send({ t: "create", name: "quiet" });
    const quietRoom = app.rooms.get((await quiet.expect("created")).room);
    const busy = await connect();
    busy.send({ t: "create", name: "busy" });
    const busyRoom = app.rooms.get((await busy.expect("created")).room);

    clock.v += ROOM_IDLE_TTL_MS - 10;
    await busy.settle();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await health()).rooms, 2, "nothing expires before the idle period");

    clock.v += 20;
    await quiet.expect("room-closed");
    assert.equal(quietRoom.state, "closed");
    assert.equal(quietRoom.graceUntil, null);
    assert.equal(app.rooms.roomOf(quiet.ready.id), undefined);

    assert.equal(busyRoom.state, "open", "other rooms unaffected");
    assert.equal((await busy.settle()).includes("room-closed"), false);
    assert.equal(app.rooms.get(busyRoom.code), busyRoom);
    const body = await health();
    assert.deepEqual([body.rooms, body.players], [1, 1]);
  }, { sweepEvery: 5 });
});

test("closing the server clears its sweep timer", async () => {
  const original = globalThis.setInterval;
  const handles = [];
  globalThis.setInterval = (...args) => { const handle = original(...args); handles.push(handle); return handle; };
  let app;
  try {
    app = createServer({ publicDir, webSocketServer: WebSocketServer, sweepEvery: 5 });
  } finally {
    globalThis.setInterval = original;
  }
  await app.listen(0, "127.0.0.1");
  assert.equal(handles.length, 1, "one sweep timer for the whole registry, none per room");
  assert.equal(handles[0]._destroyed, false);
  await app.close();
  assert.equal(handles[0]._destroyed, true);
});

test("a signal for an absent peer is answered to its sender only", async () => {
  await withServer(async ({ connect }) => {
    const host = await connect();
    host.send({ t: "create", name: "host" });
    const created = await host.expect("created");
    const guest = await connect();
    guest.send({ t: "join", room: created.room, name: "guest" });
    await guest.expect("joined");
    await host.expect("peer");

    guest.send({ t: "signal", to: "999", data: { sdp: "offer" } });
    assert.equal((await guest.expect("error")).code, "no_such_peer");
    assert.deepEqual(await host.settle(), [], "the host heard nothing about it");
    assert.equal(guest.socket.readyState, WebSocket.OPEN);
  });
});

test("a payload at the socket limit is handled and one byte more closes the connection at the socket layer", async () => {
  await withServer(async ({ app, connect, health }) => {
    const host = await connect();
    host.send({ t: "create", name: "host" });
    const created = await host.expect("created");
    const guest = await connect();
    guest.send({ t: "join", room: created.room, name: "guest" });
    await guest.expect("joined");
    await host.expect("peer");

    const padded = (bytes) => {
      const shell = JSON.stringify({ t: "ping", pad: "" });
      return JSON.stringify({ t: "ping", pad: "x".repeat(bytes - shell.length) });
    };
    assert.equal(padded(WS_MAX_PAYLOAD_BYTES).length, WS_MAX_PAYLOAD_BYTES);
    guest.socket.send(padded(WS_MAX_PAYLOAD_BYTES));
    assert.equal((await guest.expect("pong")).t, "pong");

    guest.socket.send(padded(WS_MAX_PAYLOAD_BYTES + 1));
    assert.equal(await guest.closed, 1009, "closed by the socket layer as too big");
    assert.equal(guest.inbox.some((m) => m.t === "error"), false, "the message never reached the handler");
    await host.expect("leave");
    assert.equal(host.socket.readyState, WebSocket.OPEN);
    assert.equal((await health()).players, 1);
    assert.equal(app.rooms.get(created.room).state, "open");
  });
});

test("the socket limit is injectable on the server", async () => {
  await withServer(async ({ connect }) => {
    const client = await connect();
    client.socket.send(JSON.stringify({ t: "ping", pad: "x".repeat(200) }));
    assert.equal(await client.closed, 1009);
    const small = await connect();
    assert.deepEqual(await small.settle(), []);
  }, { maxPayload: 128 });
});

test("a guest whose handshake carries another protocol version is refused by name and not admitted", async () => {
  await withServer(async ({ app, connect, health }) => {
    const host = await connect();
    host.send({ t: "create", name: "host", v: PROTOCOL_VERSION, schema: "aaaa1111" });
    const created = await host.expect("created");
    const guest = await connect();
    guest.send({ t: "join", room: created.room, name: "guest", v: PROTOCOL_VERSION + 1, schema: "aaaa1111" });
    const error = await guest.expect("error");
    assert.deepEqual([error.code, error.expected], ["protocol_mismatch", PROTOCOL_VERSION]);
    assert.deepEqual(await host.settle(), [], "the host never hears of the refused guest");
    assert.equal(app.rooms.get(created.room).members.size, 1);
    assert.equal(app.rooms.roomOf(guest.ready.id), undefined);
    assert.equal((await health()).players, 1);
  });
});

test("a guest whose handshake carries another schema hash is refused by name and not admitted", async () => {
  await withServer(async ({ app, connect, health }) => {
    const host = await connect();
    host.send({ t: "create", name: "host", v: PROTOCOL_VERSION, schema: "aaaa1111" });
    const created = await host.expect("created");
    const guest = await connect();
    guest.send({ t: "join", room: created.room, name: "guest", v: PROTOCOL_VERSION, schema: "bbbb2222" });
    const error = await guest.expect("error");
    assert.deepEqual([error.code, error.expected], ["schema_mismatch", "aaaa1111"]);
    assert.deepEqual(await host.settle(), [], "the host never hears of the refused guest");
    assert.equal(app.rooms.get(created.room).members.size, 1);
    assert.equal(app.rooms.roomOf(guest.ready.id), undefined);
    assert.equal((await health()).players, 1);

    // The same socket is admitted once it offers the host's schema.
    guest.send({ t: "join", room: created.room, name: "guest", v: PROTOCOL_VERSION, schema: "aaaa1111" });
    assert.equal((await guest.expect("joined")).spectator, false);
    assert.equal((await host.expect("peer")).name, "guest");
  });
});

test("a peer that states no schema is admitted as before", async () => {
  await withServer(async ({ connect }) => {
    const host = await connect();
    host.send({ t: "create", name: "host", schema: "aaaa1111" });
    const created = await host.expect("created");
    const guest = await connect();
    guest.send({ t: "join", room: created.room, name: "guest" });
    assert.equal((await guest.expect("joined")).spectator, false);
  });
});
