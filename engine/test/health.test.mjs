// Phase 10: the health endpoint read while a room is live.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../server.js";
import { ENGINE_VERSION, PROTOCOL_VERSION } from "../params.js";

const require = createRequire(new URL("../../achtung/package.json", import.meta.url));
const { WebSocketServer, WebSocket } = require("ws");

function peer(url) {
  const socket = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  socket.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    const at = waiters.findIndex((w) => w.kind === msg.t);
    if (at >= 0) waiters.splice(at, 1)[0].resolve(msg); else inbox.push(msg);
  });
  return {
    send: (msg) => socket.send(JSON.stringify(msg)),
    expect: (kind) => {
      const at = inbox.findIndex((m) => m.t === kind);
      if (at >= 0) return Promise.resolve(inbox.splice(at, 1)[0]);
      return new Promise((resolve) => { waiters.push({ kind, resolve }); });
    },
    close: () => socket.close(),
  };
}

test("health reports live counts, versions and uptime mid-game and mutates no room", async () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-health-"));
  fs.writeFileSync(path.join(publicDir, "index.html"), "<!doctype html>");
  const clock = { v: 5_000 };
  const app = createServer({ publicDir, webSocketServer: WebSocketServer, now: () => clock.v, seed: 3, sweepEvery: 1_000_000 });
  const { port } = await app.listen(0, "127.0.0.1");
  const health = async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { Origin: "https://superapp.example" } });
    return { body: await res.json(), headers: res.headers };
  };
  const sockets = [];
  const join = async (message) => {
    const p = peer(`ws://127.0.0.1:${port}/ws`);
    sockets.push(p);
    await p.expect("ready");
    p.send(message);
    return p;
  };
  try {
    const host = await join({ t: "create", name: "host" });
    const { room } = await host.expect("created");
    await (await join({ t: "join", room, name: "guest" })).expect("joined");
    host.send({ t: "start" });
    await host.expect("started");
    const late = await join({ t: "join", room, name: "late" });
    assert.equal((await late.expect("joined")).spectator, true);

    clock.v += 1234;
    const before = JSON.stringify(app.rooms.counts());
    const { body, headers } = await health();
    assert.deepEqual(body, {
      ok: true, rooms: 1, players: 2, spectators: 1,
      engine: ENGINE_VERSION, protocol: PROTOCOL_VERSION, uptimeMs: 1234,
    });
    assert.equal(headers.get("access-control-allow-origin"), "*");
    assert.equal(headers.get("cache-control"), "no-store");
    await health();
    assert.equal(JSON.stringify(app.rooms.counts()), before, "reading health changes no room");
  } finally {
    for (const socket of sockets) socket.close();
    await app.close();
  }
});
