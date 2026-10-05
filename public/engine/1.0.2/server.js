// Static files, health, and signalling. Gameplay never reaches this process:
// peers exchange SDP and ICE here, then talk over WebRTC DataChannels.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRooms } from "./rooms.js";
import { seededRng } from "./rng.js";
import {
  ENGINE_VERSION, PROTOCOL_VERSION, ROOM_IDLE_TTL_MS, SUPERAPP_ORIGIN, WS_MAX_PAYLOAD_BYTES,
} from "./params.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ico": "image/x-icon",
};

// `webSocketServer` is injected so the engine loads without a dependency at
// the repository root, and so a test can drive signalling with a fake.
// `superappDir` is the development switch: the superapp's static tree is
// served from disk and pages are repointed at it, so a pinned game runs offline.
export function createServer({ publicDir, superappDir, webSocketServer, now = Date.now, seed = Date.now(), sweepEvery = ROOM_IDLE_TTL_MS / 15, maxPayload = WS_MAX_PAYLOAD_BYTES } = {}) {
  if (!publicDir) throw new Error("createServer: publicDir is required");
  if (!webSocketServer) throw new Error("createServer: webSocketServer is required");
  const root = path.resolve(publicDir);
  const superapp = superappDir ? path.resolve(superappDir) : null;
  const rooms = createRooms({ now, rng: seededRng(seed) });
  const startedAt = now();
  let nextPeerId = 1;

  const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
  const toRoom = (room, msg, except) => {
    for (const member of room.members.values()) {
      if (member.peerId !== except && member.ws) send(member.ws, msg);
    }
  };
  const roster = (room) => [...room.members.values()].map((m) => ({
    id: m.peerId, name: m.name, spectator: m.spectator, connected: m.connected,
  }));

  function admit(ws, result, requested) {
    if (result.error) return send(ws, { t: "error", code: result.error });
    const { room, member, kind } = result;
    member.ws = ws;
    ws.meta.room = room.code;
    send(ws, {
      t: kind === "rejoin" ? "rejoined" : "joined",
      room: room.code, id: member.peerId, host: room.hostId,
      token: member.token, spectator: member.spectator,
      state: room.state, peers: roster(room),
    });
    toRoom(room, { t: "peer", id: member.peerId, name: member.name, spectator: member.spectator }, member.peerId);
    if (kind === "rejoin" && room.state === "playing") {
      toRoom(room, { t: "resumed", id: member.peerId }, member.peerId);
    }
    return undefined;
  }

  function onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return send(ws, { t: "error", code: "bad_json" }); }
    if (msg.v !== undefined && msg.v !== PROTOCOL_VERSION) {
      return send(ws, { t: "error", code: "protocol_mismatch", expected: PROTOCOL_VERSION });
    }
    const room = rooms.roomOf(ws.meta.id);
    if (room) rooms.touch(room);

    switch (msg.t) {
      case "ping":
        return send(ws, { t: "pong", at: now() });
      case "create": {
        const created = rooms.create(ws.meta.id, msg.name);
        created.member.ws = ws;
        if (typeof msg.schema === "string") created.room.schema = msg.schema;
        ws.meta.room = created.room.code;
        return send(ws, {
          t: "created", room: created.room.code, id: ws.meta.id,
          token: created.member.token, state: created.room.state,
        });
      }
      case "join": {
        // A guest built against another snapshot schema would diverge silently; refuse it here.
        const wanted = rooms.get(msg.room);
        if (wanted?.schema && typeof msg.schema === "string" && msg.schema !== wanted.schema) {
          return send(ws, { t: "error", code: "schema_mismatch", expected: wanted.schema });
        }
        return admit(ws, rooms.join(ws.meta.id, msg), msg);
      }
      case "start": {
        const result = rooms.startPlaying(ws.meta.id);
        if (result.error) return send(ws, { t: "error", code: result.error });
        return toRoom(result.room, { t: "started", state: result.room.state });
      }
      case "signal": {
        if (!room) return send(ws, { t: "error", code: "no_such_room" });
        const target = room.members.get(msg.to);
        if (!target || !target.ws) return send(ws, { t: "error", code: "no_such_peer" });
        return send(target.ws, { t: "signal", from: ws.meta.id, data: msg.data });
      }
      default:
        return send(ws, { t: "error", code: "unknown_type" });
    }
  }

  function onClose(ws) {
    const effect = rooms.disconnect(ws.meta.id);
    if (!effect) return;
    const { room, event, member } = effect;
    if (event === "closed") {
      for (const peer of room.members.values()) if (peer.ws) send(peer.ws, { t: "room-closed" });
      return;
    }
    toRoom(room, { t: event === "host-absent" ? "host-absent" : "leave", id: member.peerId }, member.peerId);
  }

  const wss = new webSocketServer({ noServer: true, maxPayload });
  wss.on("connection", (ws) => {
    ws.meta = { id: String(nextPeerId++), room: null };
    send(ws, { t: "ready", v: PROTOCOL_VERSION, engine: ENGINE_VERSION, id: ws.meta.id });
    ws.on("message", (raw) => onMessage(ws, raw.toString()));
    ws.on("close", () => onClose(ws));
    ws.on("error", () => onClose(ws));
  });

  function serveStatic(req, res, pathname) {
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const shared = superapp && /^(engine|assets)\//.test(rel);
    const base = shared ? superapp : root;
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err && rel === "favicon.ico") { res.writeHead(204); return res.end(); }
      if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not Found"); }
      if (superapp && file.endsWith(".html")) data = data.toString().replaceAll(SUPERAPP_ORIGIN, "");
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        ...(shared ? { "Access-Control-Allow-Origin": "*" } : {}),
      });
      res.end(data);
    });
  }

  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/healthz") {
      const counts = rooms.counts();
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      return res.end(JSON.stringify({
        ok: true, ...counts,
        engine: ENGINE_VERSION, protocol: PROTOCOL_VERSION,
        uptimeMs: now() - startedAt,
      }));
    }
    if (pathname === "/ws") { res.writeHead(426, { "Content-Type": "text/plain" }); return res.end("Upgrade Required"); }
    if (req.method !== "GET") { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, pathname);
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname !== "/ws") return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  const sweeper = setInterval(() => {
    for (const room of rooms.sweep()) {
      for (const member of room.members.values()) if (member.ws) send(member.ws, { t: "room-closed" });
    }
  }, sweepEvery);
  sweeper.unref?.();

  return {
    server, rooms, wss,
    listen: (port, host) => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => new Promise((resolve) => { clearInterval(sweeper); wss.close(); server.close(resolve); }),
  };
}

export async function serveGame({
  publicDir, superappDir = process.env.SUPERAPP_LOCAL_DIR,
  port = Number(process.env.PORT || 8080), host = process.env.HOST || "0.0.0.0",
}) {
  const { WebSocketServer } = await import("ws");
  const app = createServer({ publicDir, superappDir, webSocketServer: WebSocketServer });
  return app.listen(port, host).then((address) => {
    console.log(`listening on http://${host}:${port} (engine ${ENGINE_VERSION})`);
    return { ...app, address };
  });
}
