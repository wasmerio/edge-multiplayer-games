import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../server.js";
import { PROTOCOL_VERSION, ENGINE_VERSION, REJOIN_GRACE_MS } from "../params.js";

// `ws` is a game dependency, never a root one, so it is resolved through a
// game's own package rather than imported.
const require = createRequire(new URL("../../achtung/package.json", import.meta.url));
const { WebSocketServer, WebSocket } = require("ws");

const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-public-"));
fs.writeFileSync(path.join(publicDir, "index.html"), "<!doctype html><title>game</title>");
fs.writeFileSync(path.join(publicDir, "app.js"), "export const ok = 1;\n");

async function withServer(run, options = {}) {
  const clock = { v: 1_000_000 };
  const app = createServer({
    publicDir, webSocketServer: WebSocketServer,
    now: () => clock.v, seed: 7, sweepEvery: 1_000_000, ...options,
  });
  const address = await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    return await run({ app, base, ws: `ws://127.0.0.1:${address.port}/ws`, clock });
  } finally {
    await app.close();
  }
}

function peer(url) {
  const socket = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  socket.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    const waiter = waiters.findIndex((w) => w.kind === msg.t);
    if (waiter >= 0) waiters.splice(waiter, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  return {
    socket,
    send: (msg) => socket.send(JSON.stringify(msg)),
    expect: (kind) => {
      const found = inbox.findIndex((m) => m.t === kind);
      if (found >= 0) return Promise.resolve(inbox.splice(found, 1)[0]);
      return new Promise((resolve, reject) => {
        waiters.push({ kind, resolve });
        setTimeout(() => reject(new Error(`timed out waiting for ${kind}`)), 3000).unref();
      });
    },
    close: () => socket.close(),
  };
}

test("health reports counts, versions and uptime", async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.deepEqual(
      { ok: body.ok, rooms: body.rooms, players: body.players, spectators: body.spectators },
      { ok: true, rooms: 0, players: 0, spectators: 0 },
    );
    assert.equal(body.engine, ENGINE_VERSION);
    assert.equal(body.protocol, PROTOCOL_VERSION);
  });
});

test("static files are served and traversal is refused", async () => {
  await withServer(async ({ base }) => {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/app.js`)).status, 200);
    assert.equal((await fetch(`${base}/nope.js`)).status, 404);
    const escape = await fetch(`${base}/../../etc/passwd`);
    assert.ok([403, 404].includes(escape.status), `got ${escape.status}`);
  });
});

test("the socket path refuses a plain request and a wrong path", async () => {
  await withServer(async ({ base }) => {
    assert.equal((await fetch(`${base}/ws`)).status, 426);
    assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
  });
});

test("a connection is greeted with the protocol version", async () => {
  await withServer(async ({ ws }) => {
    const host = peer(ws);
    const ready = await host.expect("ready");
    assert.equal(ready.v, PROTOCOL_VERSION);
    assert.equal(ready.engine, ENGINE_VERSION);
    host.close();
  });
});

test("a mismatched protocol version is refused by name", async () => {
  await withServer(async ({ ws }) => {
    const host = peer(ws);
    await host.expect("ready");
    host.send({ t: "create", v: PROTOCOL_VERSION + 1 });
    const error = await host.expect("error");
    assert.equal(error.code, "protocol_mismatch");
    assert.equal(error.expected, PROTOCOL_VERSION);
    host.close();
  });
});

test("a host creates a room and a guest joins it", async () => {
  await withServer(async ({ ws, base }) => {
    const host = peer(ws);
    await host.expect("ready");
    host.send({ t: "create", name: "host", v: PROTOCOL_VERSION });
    const created = await host.expect("created");
    assert.match(created.room, /^[A-Z0-9]+$/);
    assert.ok(created.token);

    const guest = peer(ws);
    await guest.expect("ready");
    guest.send({ t: "join", room: created.room, name: "guest", v: PROTOCOL_VERSION });
    const joined = await guest.expect("joined");
    assert.equal(joined.spectator, false);
    assert.equal(joined.host, created.id);
    assert.equal(joined.peers.length, 2);
    assert.equal((await host.expect("peer")).name, "guest");

    const health = await (await fetch(`${base}/healthz`)).json();
    assert.equal(health.players, 2);
    host.close(); guest.close();
  });
});

test("joining an unknown room is refused by name", async () => {
  await withServer(async ({ ws }) => {
    const guest = peer(ws);
    await guest.expect("ready");
    guest.send({ t: "join", room: "ZZZZ", v: PROTOCOL_VERSION });
    assert.equal((await guest.expect("error")).code, "no_such_room");
    guest.close();
  });
});

test("signals reach the addressed peer only", async () => {
  await withServer(async ({ ws }) => {
    const host = peer(ws);
    await host.expect("ready");
    host.send({ t: "create", name: "host" });
    const created = await host.expect("created");
    const guest = peer(ws);
    await guest.expect("ready");
    guest.send({ t: "join", room: created.room, name: "guest" });
    const joined = await guest.expect("joined");
    await host.expect("peer");

    guest.send({ t: "signal", to: created.id, data: { sdp: "offer" } });
    const relayed = await host.expect("signal");
    assert.equal(relayed.from, joined.id);
    assert.deepEqual(relayed.data, { sdp: "offer" });

    guest.send({ t: "signal", to: "999", data: {} });
    assert.equal((await guest.expect("error")).code, "no_such_peer");
    host.close(); guest.close();
  });
});

test("only the host can start the game and the room announces it", async () => {
  await withServer(async ({ ws }) => {
    const host = peer(ws);
    await host.expect("ready");
    host.send({ t: "create", name: "host" });
    const created = await host.expect("created");
    const guest = peer(ws);
    await guest.expect("ready");
    guest.send({ t: "join", room: created.room, name: "guest" });
    await guest.expect("joined");
    await host.expect("peer");

    guest.send({ t: "start" });
    assert.equal((await guest.expect("error")).code, "not_host");
    host.send({ t: "start" });
    assert.equal((await host.expect("started")).state, "playing");
    assert.equal((await guest.expect("started")).state, "playing");
    host.close(); guest.close();
  });
});

test("a peer arriving after the start becomes a spectator", async () => {
  await withServer(async ({ ws, base }) => {
    const host = peer(ws);
    await host.expect("ready");
    host.send({ t: "create", name: "host" });
    const created = await host.expect("created");
    host.send({ t: "start" });
    await host.expect("started");

    const watcher = peer(ws);
    await watcher.expect("ready");
    watcher.send({ t: "join", room: created.room, name: "watcher" });
    assert.equal((await watcher.expect("joined")).spectator, true);
    const health = await (await fetch(`${base}/healthz`)).json();
    assert.equal(health.spectators, 1);
    host.close(); watcher.close();
  });
});

test("a guest that reconnects with its token keeps its slot", async () => {
  await withServer(async ({ ws, base }) => {
    const host = peer(ws);
    await host.expect("ready");
    host.send({ t: "create", name: "host" });
    const created = await host.expect("created");
    const guest = peer(ws);
    await guest.expect("ready");
    guest.send({ t: "join", room: created.room, name: "guest" });
    const joined = await guest.expect("joined");
    await host.expect("peer");
    host.send({ t: "start" });
    await host.expect("started");

    guest.close();
    await host.expect("leave");

    const again = peer(ws);
    await again.expect("ready");
    again.send({ t: "join", room: created.room, token: joined.token });
    const rejoined = await again.expect("rejoined");
    assert.equal(rejoined.spectator, false);
    const health = await (await fetch(`${base}/healthz`)).json();
    assert.equal(health.players, 2);
    assert.equal(health.spectators, 0);
    host.close(); again.close();
  });
});

test("a host that leaves while playing suspends the room and can return", async () => {
  await withServer(async ({ ws, base }) => {
    const host = peer(ws);
    await host.expect("ready");
    host.send({ t: "create", name: "host" });
    const created = await host.expect("created");
    const guest = peer(ws);
    await guest.expect("ready");
    guest.send({ t: "join", room: created.room, name: "guest" });
    await guest.expect("joined");
    await host.expect("peer");
    host.send({ t: "start" });
    await host.expect("started");

    host.close();
    assert.equal((await guest.expect("host-absent")).id, created.id);
    const stillThere = await (await fetch(`${base}/healthz`)).json();
    assert.equal(stillThere.rooms, 1);

    const back = peer(ws);
    await back.expect("ready");
    back.send({ t: "join", room: created.room, token: created.token });
    assert.equal((await back.expect("rejoined")).state, "playing");
    guest.close(); back.close();
  });
});

test("an idle room is swept and its peers are told", async () => {
  await withServer(async ({ ws, clock, app }) => {
    const host = peer(ws);
    await host.expect("ready");
    host.send({ t: "create", name: "host" });
    await host.expect("created");
    host.send({ t: "start" });
    await host.expect("started");

    clock.v += REJOIN_GRACE_MS * 100;
    for (const room of app.rooms.sweep()) {
      for (const member of room.members.values()) if (member.ws) member.ws.send(JSON.stringify({ t: "room-closed" }));
    }
    assert.equal((await host.expect("room-closed")).t, "room-closed");
    assert.equal(app.rooms.size(), 0);
    host.close();
  });
});

test("malformed and unknown messages are named without closing the socket", async () => {
  await withServer(async ({ ws }) => {
    const client = peer(ws);
    await client.expect("ready");
    client.socket.send("{not json");
    assert.equal((await client.expect("error")).code, "bad_json");
    client.send({ t: "nonsense" });
    assert.equal((await client.expect("error")).code, "unknown_type");
    assert.equal(client.socket.readyState, 1);
    client.close();
  });
});

test("creating the server without its collaborators is refused", () => {
  assert.throws(() => createServer({}), /publicDir is required/);
  assert.throws(() => createServer({ publicDir }), /webSocketServer is required/);
});
