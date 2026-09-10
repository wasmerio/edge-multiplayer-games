// Lobby (WebSocket signaling) + WebRTC star topology + renderer.
// The host tab additionally runs the simulation from game.js.
import { Game, COLORS, TICK_HZ, MAP, mapSize } from "/game.js";

const $ = (id) => document.getElementById(id);
const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

const state = {
  ws: null,
  myId: null,
  hostId: null,
  room: null,
  peers: new Map(), // peerId -> { name, pc, dc }
  players: [], // [{ pid, owner, slot, name, color, score }]
  game: null,
  inputs: [],
  prev: [],
  localDirs: [0, 0],
  tickTimer: null,
  target: 10,
  map: { w: MAP.baseW, h: MAP.baseH },
};
const isHost = () => state.myId && state.myId === state.hostId;
window.achtung = state;

// ---------- signaling ----------
function connectWs() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => {
    setStatus("connected");
    const params = new URLSearchParams(location.search);
    const code = params.get("room");
    if (code) {
      $("code").value = code.toUpperCase();
      sig({ t: "join", room: code, name: myName() });
    } else if (params.has("create")) {
      sig({ t: "create", name: myName() });
    }
    setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ t: "ping" })), 20000);
  };
  ws.onclose = () => setStatus("signaling closed (reload to rejoin)");
  ws.onerror = () => setStatus("signaling error");
  ws.onmessage = (ev) => onSignal(JSON.parse(ev.data));
}
const sig = (msg) => state.ws.send(JSON.stringify(msg));
function myName() {
  let n = $("name").value.trim();
  if (!n) {
    n = localStorage.getItem("achtung-name") || `player-${Math.random().toString(36).slice(2, 5)}`;
    $("name").value = n;
    try { localStorage.setItem("achtung-name", n); } catch {}
  }
  return n;
}

function onSignal(msg) {
  switch (msg.t) {
    case "created":
      state.myId = msg.id;
      state.hostId = msg.id;
      state.room = msg.room;
      state.peers.set(msg.id, { name: myName() });
      showRoom();
      return;
    case "joined":
      state.myId = msg.id;
      state.hostId = msg.host;
      state.room = msg.room;
      for (const p of msg.peers) state.peers.set(p.id, { name: p.name });
      showRoom();
      return;
    case "peer":
      state.peers.set(msg.id, { name: msg.name });
      renderPeers();
      if (isHost()) createPeer(msg.id, true);
      return;
    case "leave":
      dropPeer(msg.id);
      return;
    case "host-left":
      setStatus("host left the room");
      stopGame();
      $("game").hidden = true;
      $("lobby").hidden = false;
      $("room-info").hidden = true;
      return;
    case "signal":
      handleRtcSignal(msg.from, msg.data);
      return;
    case "error":
      setStatus(`error: ${msg.code}`);
      return;
  }
}

// ---------- WebRTC ----------
function createPeer(id, initiator) {
  const peer = state.peers.get(id) || { name: "?" };
  state.peers.set(id, peer);
  const pc = new RTCPeerConnection(ICE);
  peer.pc = pc;
  pc.onicecandidate = (e) => e.candidate && sig({ t: "signal", to: id, data: { candidate: e.candidate } });
  pc.onconnectionstatechange = () => renderRtc();
  pc.ondatachannel = (e) => attachChannel(id, e.channel);
  if (initiator) {
    attachChannel(id, pc.createDataChannel("game", { ordered: true }));
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => sig({ t: "signal", to: id, data: { sdp: pc.localDescription } }));
  }
  return peer;
}

async function handleRtcSignal(from, data) {
  let peer = state.peers.get(from);
  if (!peer || !peer.pc) peer = createPeer(from, false);
  const pc = peer.pc;
  if (data.sdp) {
    await pc.setRemoteDescription(data.sdp);
    if (data.sdp.type === "offer") {
      await pc.setLocalDescription(await pc.createAnswer());
      sig({ t: "signal", to: from, data: { sdp: pc.localDescription } });
    }
  } else if (data.candidate) {
    try {
      await pc.addIceCandidate(data.candidate);
    } catch (err) {
      console.warn("ice", err);
    }
  }
}

function attachChannel(id, dc) {
  const peer = state.peers.get(id);
  peer.dc = dc;
  dc.onopen = () => {
    renderRtc();
    if (!isHost()) dcSend(dc, { t: "hello", name: myName() });
  };
  dc.onclose = () => renderRtc();
  dc.onmessage = (ev) => onGameMessage(id, JSON.parse(ev.data));
}
const dcSend = (dc, msg) => dc && dc.readyState === "open" && dc.send(JSON.stringify(msg));
function broadcastGame(msg) {
  for (const p of state.peers.values()) dcSend(p.dc, msg);
}

function dropPeer(id) {
  const peer = state.peers.get(id);
  if (peer && peer.pc) peer.pc.close();
  state.peers.delete(id);
  renderPeers();
  if (isHost() && state.game) {
    for (const pl of state.players) if (pl.owner === id) killPlayer(pl.pid);
  }
}

// ---------- game messages ----------
function onGameMessage(from, msg) {
  if (isHost()) {
    if (msg.t === "hello") {
      state.peers.get(from).name = msg.name;
      renderPeers();
    } else if (msg.t === "i" && state.game) {
      const pl = state.players.find((p) => p.owner === from);
      if (pl) state.inputs[pl.pid] = Math.sign(msg.d | 0);
    }
    return;
  }
  applyMessage(msg);
}

// Both host and clients render through this path.
function applyMessage(msg) {
  switch (msg.t) {
    case "lobby":
      state.players = msg.players;
      state.target = msg.target;
      setArena(msg.map);
      enterGame();
      return;
    case "round":
      startRoundView(msg.n);
      return;
    case "s":
      drawSnapshot(msg);
      renderScores();
      return;
    case "score":
      for (let i = 0; i < msg.scores.length; i++) state.players[i].score = msg.scores[i];
      renderScores();
      return;
    case "over":
      showBanner(msg.winner < 0 ? "Shift complete · next round?" : `${state.players[msg.winner].name} wins!`);
      $("next").hidden = !isHost();
      $("next").textContent = msg.winner < 0 ? "Next round (Space)" : "New match (Space)";
      return;
  }
}

// ---------- host loop ----------
function hostStart() {
  updateMapInfo();
  stopGame();
  const players = [];
  const add = (owner, slot, name) =>
    players.push({ pid: players.length, owner, slot, name, color: COLORS[players.length % COLORS.length], score: 0 });
  const hostPeer = state.peers.get(state.myId);
  add(state.myId, 0, hostPeer.name);
  if ($("local2").checked) add(state.myId, 1, `${hostPeer.name} 2`);
  for (const [id, p] of state.peers) {
    if (id === state.myId || !p.dc || p.dc.readyState !== "open") continue;
    add(id, 0, p.name);
  }
  state.players = players;
  state.target = 20;
  state.map = mapSize(players.length, Number($("mapsize").value));
  state.game = new Game(players.length, state.map);
  state.inputs = new Array(players.length).fill(0);
  const lobby = { t: "lobby", players, target: state.target, map: state.map };
  broadcastGame(lobby);
  applyMessage(lobby);
  hostNextRound();
  let last = performance.now();
  let acc = 0;
  const dt = 1000 / TICK_HZ;
  state.tickTimer = setInterval(() => {
    const now = performance.now();
    acc += now - last;
    last = now;
    while (acc >= dt) {
      acc -= dt;
      hostTick();
    }
  }, dt / 2);
}

function hostNextRound() {
  const g = state.game;
  const winner = g.winner(state.target);
  if (winner >= 0) {
    const over = { t: "over", winner };
    broadcastGame(over);
    applyMessage(over);
    return;
  }
  state.inputs.fill(0);
  g.startRound();
  const msg = { t: "round", n: g.round };
  broadcastGame(msg);
  applyMessage(msg);
}

function hostTick() {
  const g = state.game;
  if (g.roundOver) return;
  for (const pl of state.players) {
    if (pl.owner === state.myId) state.inputs[pl.pid] = state.localDirs[pl.slot];
  }
  const snap = g.step(state.inputs);
  broadcastGame(snap);
  applyMessage(snap);
  if (snap.d.length) {
    const sc = { t: "score", scores: g.scores };
    broadcastGame(sc);
    applyMessage(sc);
  }
  if (snap.over) {
    const winner = g.winner(state.target);
    const over = { t: "over", winner };
    broadcastGame(over);
    applyMessage(over);
  }
}

function killPlayer(pid) {
  state.game.disconnect(pid);
  state.inputs[pid] = 0;
}

function stopGame() {
  clearInterval(state.tickTimer);
  state.tickTimer = null;
  state.game = null;
}

// ---------- rendering ----------
const trails = $("trails").getContext("2d");
const heads = $("heads").getContext("2d");

function setArena({ w, h }) {
  state.map = { w, h };
  for (const id of ["trails", "heads"]) {
    const c = $(id);
    c.width = w;
    c.height = h;
  }
  const arena = $("arena");
  arena.style.aspectRatio = `${w} / ${h}`;
  arena.style.width = `min(${w}px, 100%)`;
}

function updateMapInfo() {
  let n = 1;
  for (const [id, p] of state.peers) if (id !== state.myId && p.dc && p.dc.readyState === "open") n++;
  $("local2").disabled = n >= 8;
  if (n >= 8) $("local2").checked = false;
  if ($("local2").checked) n++;
  const { w, h } = mapSize(n, Number($("mapsize").value));
  $("mapinfo").textContent = `${n} delivery bay${n === 1 ? "" : "s"} · ${w}×${h}`;
}

function enterGame() {
  $("lobby").hidden = true;
  $("game").hidden = false;
  renderScores();
}

function startRoundView(n) {
  trails.clearRect(0, 0, state.map.w, state.map.h);
  heads.clearRect(0, 0, state.map.w, state.map.h);
  state.prev = [];
  $("next").hidden = true;
  held.clear();
  touchHeld.clear();
  updateDirs();
  for (const pl of state.players) pl.alive = true;
  showBanner(`Shift ${n} · get ready`, 1400);
  renderScores();
}

function drawSnapshot(snap) {
  const { w, h } = state.map;
  const ctx = heads;
  ctx.clearRect(0, 0, w, h);
  const bay = w / snap.p.length;
  const top = 65, height = h - 100;
  const lanes = [0.18, 0.5, 0.82];
  snap.p.forEach(([x, score, active, flash], i) => {
    const pl = state.players[i];
    pl.score = score;
    pl.alive = !!active;
    const left = bay * i;
    const width = bay - 12;
    const px = (v) => left + 6 + v * width;
    ctx.fillStyle = i % 2 ? "#142c39" : "#10242f";
    ctx.fillRect(left + 2, 0, bay - 4, h);
    ctx.strokeStyle = "#294754";
    ctx.lineWidth = 1;
    for (const lane of lanes) {
      ctx.beginPath(); ctx.moveTo(px(lane), top); ctx.lineTo(px(lane), h - 20); ctx.stroke();
    }
    ctx.font = `bold ${Math.min(18, bay / 9)}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillStyle = pl.color;
    ctx.fillText(`${pl.owner === state.myId ? 'YOU · ' : ''}${pl.name}`, left + bay / 2, 26, bay - 12);
    ctx.font = "14px system-ui";
    ctx.fillText(active ? `${score} / ${state.target}` : "disconnected", left + bay / 2, 47, bay - 10);
    for (const [, lane, y, type, mask] of snap.b) {
      if ((mask & (1 << i)) || !active) continue;
      const bx = px(lanes[lane]), by = top + y * height;
      const r = Math.min(15, width * 0.09);
      ctx.fillStyle = type === 1 ? "#6cf2bc" : "#ff7289";
      ctx.fillRect(bx - r, by - r, r * 2, r * 2);
      ctx.fillStyle = "#10242f";
      ctx.font = `bold ${r * 1.5}px system-ui`;
      ctx.fillText(type === 1 ? "+" : "×", bx, by + r * 0.5);
    }
    if (active) {
      const cy = top + 0.88 * height;
      ctx.fillStyle = flash < 0 ? "#ff7289" : flash > 0 ? "#ffffff" : pl.color;
      ctx.fillRect(px(x) - width * 0.13, cy, width * 0.26, 13);
      ctx.fillRect(px(x) - width * 0.13, cy - 8, 4, 10);
      ctx.fillRect(px(x) + width * 0.13 - 4, cy - 8, 4, 10);
    }
  });
  $("clock").textContent = snap.f ? `Ready in ${Math.ceil(snap.f / TICK_HZ)}` : `${Math.ceil(snap.left / TICK_HZ)}s left`;
}

let bannerTimer;
function showBanner(text, ms) {
  const b = $("banner");
  b.textContent = text;
  b.hidden = false;
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => (b.hidden = true), ms);
}

function renderScores() {
  const ol = $("scores");
  ol.innerHTML = "";
  for (const pl of state.players) {
    const li = document.createElement("li");
    li.className = pl.alive === false ? "dead" : "";
    li.innerHTML = `<span class="swatch" style="background:${pl.color}"></span>${esc(pl.name)}: ${pl.score}`;
    ol.appendChild(li);
  }
  const target = document.createElement("li");
  target.className = "muted";
  target.style.listStyle = "none";
  target.textContent = `first to ${state.target}`;
  ol.appendChild(target);
}

function renderPeers() {
  const ul = $("peers");
  ul.innerHTML = "";
  for (const [id, p] of state.peers) {
    const li = document.createElement("li");
    li.textContent = p.name + (id === state.myId ? " (you)" : "");
    if (id === state.hostId) li.classList.add("host");
    ul.appendChild(li);
  }
  renderRtc();
}

function renderRtc() {
  const parts = [];
  for (const [id, p] of state.peers) {
    if (id === state.myId || !p.pc) continue;
    parts.push(`${p.name}: ${p.pc.connectionState}/${p.dc ? p.dc.readyState : "-"}`);
  }
  $("rtc").textContent = parts.join(" · ");
  if (isHost()) updateMapInfo();
  const peersEl = $("peers");
  peersEl.title = parts.join("\n");
}

function showRoom() {
  $("room-info").hidden = false;
  $("room-code").textContent = state.room;
  $("host-controls").hidden = !isHost();
  $("wait").hidden = isHost();
  $("create").disabled = true;
  $("join").disabled = true;
  history.replaceState(null, "", `?room=${state.room}`);
  const link = `${location.origin}/?room=${state.room}`;
  $("invite-link").textContent = link;
  $("invite-link").href = link;
  $("invite").hidden = !isHost();
  renderPeers();
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const setStatus = (s) => ($("status").textContent = s);

// ---------- input ----------
const KEYS = { ArrowLeft: [0, -1], ArrowRight: [0, 1], KeyA: [1, -1], KeyD: [1, 1] };
const held = new Set();
const touchHeld = new Map();
function updateDirs() {
  const dirs = [0, 0];
  for (const code of held) {
    const [slot, d] = KEYS[code];
    dirs[slot] += d;
  }
  for (const d of touchHeld.values()) dirs[0] += d;
  const next = dirs.map(Math.sign);
  const changed = next[0] !== state.localDirs[0];
  state.localDirs = next;
  if (!isHost() && changed) {
    const host = state.peers.get(state.hostId);
    if (host) dcSend(host.dc, { t: "i", d: state.localDirs[0] });
  }
}
function advanceRound() {
  if (!isHost() || !state.game || !state.game.roundOver) return;
  if (state.game.winner(state.target) >= 0) hostStart();
  else hostNextRound();
}
window.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) || $("game").hidden) return;
  if (e.code === "Space" && !e.repeat && isHost() && state.game && state.game.roundOver) {
    e.preventDefault();
    advanceRound();
    return;
  }
  if (KEYS[e.code] && !e.repeat) {
    e.preventDefault();
    held.add(e.code);
    updateDirs();
  }
});
window.addEventListener("keyup", (e) => {
  if (KEYS[e.code]) {
    held.delete(e.code);
    updateDirs();
  }
});
function releaseInputs() {
  held.clear();
  touchHeld.clear();
  updateDirs();
}
window.addEventListener("blur", releaseInputs);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseInputs(); });
for (const [id, d] of [["left", -1], ["right", 1]]) {
  const button = $(id);
  button.onpointerdown = (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    touchHeld.set(e.pointerId, d);
    updateDirs();
  };
  const release = (e) => { touchHeld.delete(e.pointerId); updateDirs(); };
  button.onpointerup = release;
  button.onpointercancel = release;
  button.onlostpointercapture = release;
}
$("next").onclick = advanceRound;

// ---------- lobby UI ----------
$("create").onclick = () => sig({ t: "create", name: myName() });
$("join").onclick = () => sig({ t: "join", room: $("code").value.trim(), name: myName() });
$("start").onclick = () => hostStart();
$("mapsize").onchange = updateMapInfo;
$("local2").onchange = updateMapInfo;
$("copy-link").onclick = async () => {
  await navigator.clipboard.writeText(`${location.origin}/?room=${state.room}`);
  $("copy-link").textContent = "copied!";
  setTimeout(() => ($("copy-link").textContent = "copy"), 1500);
};
$("name").value = localStorage.getItem("achtung-name") || "";
$("name").onchange = () => localStorage.setItem("achtung-name", $("name").value);

connectWs();
