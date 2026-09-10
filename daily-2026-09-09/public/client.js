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
      if (msg.d.length) renderScores();
      return;
    case "score":
      for (let i = 0; i < msg.scores.length; i++) state.players[i].score = msg.scores[i];
      renderScores();
      return;
    case "over":
      state.matchOver = msg.winner >= 0;
      $("next").hidden = !isHost();
      $("next").textContent = state.matchOver ? "New match · Space" : "Next shift · Space";
      showBanner(msg.winner < 0 ? "Vault closed · unbanked ore lost" : `${state.players[msg.winner].name} wins!`);
      return;
  }
}

// ---------- host loop ----------
function hostStart() {
  stopGame();
  const players = [];
  const add = (owner, slot, name) =>
    players.push({ pid: players.length, owner, slot, name, color: COLORS[players.length % COLORS.length], score: 0 });
  const hostPeer = state.peers.get(state.myId);
  add(state.myId, 0, hostPeer.name);
  if ($("local2").checked) add(state.myId, 1, `${hostPeer.name} 2`);
  for (const [id, p] of state.peers) {
    if (id === state.myId || !p.dc || p.dc.readyState !== "open" || players.length >= 8) continue;
    add(id, 0, p.name);
  }
  state.players = players;
  state.target = 60;
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
    acc += Math.min(now - last, 200);
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
  g.startRound();
  const msg = { t: "round", n: g.round };
  broadcastGame(msg);
  applyMessage(msg);
}

function hostTick() {
  const g = state.game;
  if (!g || g.roundOver) return;
  for (const pl of state.players) {
    if (pl.owner !== state.myId && state.peers.get(pl.owner)?.dc?.readyState !== "open") killPlayer(pl.pid);
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
  let n = 1 + ($("local2").checked ? 1 : 0);
  for (const [id, p] of state.peers) if (id !== state.myId && p.dc && p.dc.readyState === "open") n++;
  const { w, h } = mapSize(n, Number($("mapsize").value));
  $("mapinfo").textContent = `${Math.min(n, 8)} miners · 30-second shifts · display ${w}×${h}`;
}

function enterGame() {
  releaseInput();
  $("lobby").hidden = true;
  $("game").hidden = false;
  renderScores();
}

function startRoundView(n) {
  trails.clearRect(0, 0, state.map.w, state.map.h);
  heads.clearRect(0, 0, state.map.w, state.map.h);
  state.matchOver = false;
  $("next").hidden = true;
  $("event").textContent = "Bank before the clock runs out.";
  showBanner(`Shift ${n} · drill, cool, bank`, 1000);
  renderScores();
  updateDirs();
}

function drawSnapshot(snap) {
  const { w, h } = state.map;
  const ctx = heads;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.scale(w / 900, h / (140 + Math.max(2, snap.p.length) * 100));
  const text = (value, x, y, color = "#e8f4ee", size = 16) => {
    ctx.fillStyle = color;
    ctx.font = `600 ${size}px system-ui`;
    ctx.fillText(value, x, y);
  };
  const bar = (x, y, width, fraction, color) => {
    ctx.fillStyle = "#25393b";
    ctx.fillRect(x, y, width, 10);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * Math.max(0, Math.min(1, fraction)), 10);
  };
  const rich = snap.v[0];
  text(rich ? "RICH VEIN · 3× ORE / 2× HEAT" : "STEADY VEIN · 1× ORE", 24, 35, rich ? "#ffbd69" : "#64e8ca", 22);
  text(`${Math.ceil((900 - snap.k) / TICK_HZ)}s`, 800, 35, "#ffffff", 26);
  text(`${rich ? "Steady" : "Rich"} vein in ${(snap.v[1] / TICK_HZ).toFixed(1)}s`, 24, 64, "#a2b7b8");
  bar(24, 79, 852, 1 - snap.k / 900, "#64e8ca");
  snap.p.forEach(([heat, haul, bank, lock, mode, active, score], i) => {
    const pl = state.players[i];
    pl.alive = !!active;
    pl.score = score;
    const y = 112 + i * 100;
    ctx.fillStyle = active ? "#162a2e" : "#182020";
    ctx.fillRect(16, y, 868, 90);
    ctx.fillStyle = pl.color;
    ctx.fillRect(16, y, 4, 90);
    const you = pl.owner === state.myId ? " · YOU" : "";
    text(`${pl.name.slice(0, 16)}${you}`, 30, y + 26, pl.color);
    text(!active ? "OFFLINE" : lock ? `MELTDOWN · ${(lock / TICK_HZ).toFixed(1)}s` : mode === 1 ? "DRILLING" : mode === -1 ? "BANKING" : "COOLING", 30, y + 57, "#a2b7b8", 13);
    text(`HEAT ${heat}/90`, 290, y + 26, heat >= 65 ? "#ff8b86" : "#a2b7b8", 13);
    bar(290, y + 40, 230, heat / 90, heat >= 65 ? "#ff8b86" : "#ffbd69");
    text(`HAUL ${haul}`, 555, y + 26, "#ffbd69", 20);
    bar(555, y + 40, 140, bank / 24, "#64e8ca");
    text(`BANK ${score}`, 730, y + 26, pl.color, 20);
    bar(730, y + 40, 126, score / state.target, pl.color);
    text(bank ? "Keep holding to deposit" : "24 ticks to bank", 555, y + 70, "#a2b7b8", 12);
  });
  ctx.restore();
  $("clock").textContent = `${Math.ceil((900 - snap.k) / TICK_HZ)}s left · ${rich ? "rich vein" : "steady vein"}`;
  for (const [pid, kind, amount] of snap.d) {
    $("event").textContent = `${state.players[pid].name}: ${kind === 1 ? `banked +${amount}` : kind === 2 ? `meltdown! Lost ${amount}` : `closing lost ${amount}`}`;
  }
  if (snap.k % 15 === 0) renderScores();
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
  target.textContent = `Lead with ${state.target}+ banked at shift end`;
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
const touches = new Map();
function updateDirs() {
  const dirs = [0, 0];
  for (const d of touches.values()) dirs[0] += d;
  for (const code of held) {
    const [slot, d] = KEYS[code];
    dirs[slot] += d;
  }
  const changed = Math.sign(dirs[0]) !== state.localDirs[0];
  state.localDirs = dirs.map(Math.sign);
  if (!isHost() && changed) {
    const host = state.peers.get(state.hostId);
    if (host) dcSend(host.dc, { t: "i", d: state.localDirs[0] });
  }
}
function advance() {
  if (!isHost() || !state.game?.roundOver) return;
  if (state.matchOver) hostStart();
  else hostNextRound();
}
window.addEventListener("keydown", (e) => {
  if ($("game").hidden || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.code === "Space" && isHost() && state.game && state.game.roundOver && !e.repeat) {
    e.preventDefault();
    advance();
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
function releaseInput() {
  held.clear();
  touches.clear();
  updateDirs();
}
window.addEventListener("blur", releaseInput);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseInput(); });
for (const [id, dir] of [["bank", -1], ["drill", 1]]) {
  const button = $(id);
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, dir);
    updateDirs();
  });
  const release = (e) => { touches.delete(e.pointerId); updateDirs(); };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
}
$("next").onclick = advance;

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
