// Signaling + static server. Gameplay never touches this process: peers
// exchange SDP/ICE here, then talk over WebRTC DataChannels.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const rooms = new Map();
let nextPeerId = 1;

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newRoomCode() {
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, except) {
  for (const [id, peer] of room.peers) {
    if (id !== except) send(peer.ws, msg);
  }
}

function leave(ws) {
  const { room: code, id } = ws.meta;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  room.peers.delete(id);
  ws.meta.room = null;
  if (room.host === id || room.peers.size === 0) {
    broadcast(room, { t: "host-left" });
    for (const peer of room.peers.values()) peer.ws.meta.room = null;
    rooms.delete(code);
    console.log(`room ${code} closed`);
  } else {
    broadcast(room, { t: "leave", id });
  }
}

function onMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return send(ws, { t: "error", code: "bad_json" });
  }
  const name = String(msg.name || "anon").slice(0, 16);
  switch (msg.t) {
    case "ping":
      return send(ws, { t: "pong" });
    case "create": {
      leave(ws);
      const code = newRoomCode();
      rooms.set(code, { host: ws.meta.id, peers: new Map([[ws.meta.id, { ws, name }]]) });
      ws.meta.room = code;
      console.log(`room ${code} created by ${ws.meta.id}`);
      return send(ws, { t: "created", room: code, id: ws.meta.id });
    }
    case "join": {
      const code = String(msg.room || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: "error", code: "no_such_room" });
      if (room.peers.size >= 8) return send(ws, { t: "error", code: "room_full" });
      leave(ws);
      room.peers.set(ws.meta.id, { ws, name });
      ws.meta.room = code;
      const peers = [...room.peers].map(([id, p]) => ({ id, name: p.name }));
      send(ws, { t: "joined", room: code, id: ws.meta.id, host: room.host, peers });
      broadcast(room, { t: "peer", id: ws.meta.id, name }, ws.meta.id);
      return;
    }
    case "signal": {
      const room = rooms.get(ws.meta.room);
      const target = room && room.peers.get(msg.to);
      if (!target) return send(ws, { t: "error", code: "no_such_peer" });
      return send(target.ws, { t: "signal", from: ws.meta.id, data: msg.data });
    }
    default:
      return send(ws, { t: "error", code: "unknown_type" });
  }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
wss.on("connection", (ws) => {
  ws.meta = { id: String(nextPeerId++), room: null };
  ws.on("message", (raw) => onMessage(ws, raw.toString()));
  ws.on("close", () => leave(ws));
  ws.on("error", () => leave(ws));
});

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not Found");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname === "/healthz") {
    let players = 0;
    for (const r of rooms.values()) players += r.peers.size;
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, players }));
  }
  if (pathname === "/ws") {
    res.writeHead(426, { "Content-Type": "text/plain" });
    return res.end("Upgrade Required");
  }
  if (req.method !== "GET") {
    res.writeHead(405);
    return res.end();
  }
  serveStatic(req, res, pathname);
});

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname !== "/ws") return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

server.listen(PORT, HOST, () => {
  console.log(`listening on http://${HOST}:${PORT}`);
});
