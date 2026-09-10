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
    case "over": {
      const leaders = state.lastSnapshot?.r || [];
      const result = leaders.length ? `${leaders.map(i => state.players[i].name).join(" & ")} led the market` : "No cargo banked";
      showBanner(msg.winner < 0 ? result : `${state.players[msg.winner].name} wins the match!`);
      $("next").hidden = !isHost();
      $("next").textContent = msg.winner < 0 ? "Next round · Space" : "New match · Space";
      $("round-status").textContent = isHost() ? "Ready? Start the next shift." : "Waiting for the host to continue…";
      return;
    }
  }
}

// ---------- host loop ----------
function hostStart() {
  stopGame();
  const players = [];
  const add = (owner, slot, name) => {
    if (players.length < 8) players.push({ pid: players.length, owner, slot, name, color: COLORS[players.length], score: 0 });
  };
  const hostPeer = state.peers.get(state.myId);
  add(state.myId, 0, hostPeer.name);
  if ($("local2").checked) add(state.myId, 1, `${hostPeer.name} 2`);
  for (const [id, p] of state.peers) {
    if (id === state.myId || !p.dc || p.dc.readyState !== "open") continue;
    add(id, 0, p.name);
  }
  state.players = players;
  state.target = 5;
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
    acc += Math.min(now - last, 250);
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
    hostStart();
    return;
  }
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
  arena.style.minWidth = `${Math.min(4, state.players.length) * 180}px`;
}

function updateMapInfo() {
  let n = 1 + ($("local2").checked ? 1 : 0);
  for (const [id, p] of state.peers) if (id !== state.myId && p.dc && p.dc.readyState === "open") n++;
  n = Math.min(8, n);
  const { w, h } = mapSize(n, Number($("mapsize").value));
  $("mapinfo").textContent = `${w}×${h} · ${Math.min(8, n)} stalls · identical showers`;
}

function enterGame() {
  $("lobby").hidden = true;
  $("game").hidden = false;
  renderScores();
}

function startRoundView(n) {
  trails.clearRect(0, 0, state.map.w, state.map.h);
  heads.clearRect(0, 0, state.map.w, state.map.h);
  state.lastSnapshot = null;
  for (const pl of state.players) { pl.alive = true; pl.cargo = 0; }
  $("next").hidden = true;
  $("round-status").textContent = `Shift ${n} · catch crystals, dodge mines`;
  showBanner(`Shift ${n} · Get ready`, 950);
  renderScores();
}

function drawSnapshot(snap) {
  state.lastSnapshot = snap;
  const ctx = heads;
  const { w, h } = state.map;
  ctx.clearRect(0, 0, w, h);
  const cols = Math.min(4, state.players.length);
  const rows = Math.ceil(state.players.length / 4);
  const cw = w / cols, ch = h / rows;
  $("clock").textContent = snap.f ? "READY" : `${Math.ceil((1050 - snap.k) / TICK_HZ)}s`;
  snap.p.forEach(([x, cargo, jam, active], i) => {
    const pl = state.players[i];
    pl.alive = !!active;
    pl.cargo = cargo;
    pl.score = snap.q[i];
    const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.clip();
    ctx.fillStyle = i % 2 ? "#142436" : "#102030";
    ctx.fillRect(3, 3, cw - 6, ch - 6);
    ctx.globalAlpha = active ? 1 : 0.35;
    const pad = cw * 0.06, fieldW = cw - 2 * pad;
    const top = ch * 0.17, fieldH = ch * 0.80;
    const px = v => pad + v / 1000 * fieldW;
    const py = v => top + v / 1000 * fieldH;
    const font = Math.max(13, Math.min(22, cw * 0.063));
    ctx.font = `600 ${font}px system-ui`;
    ctx.fillStyle = pl.color;
    ctx.textAlign = "left";
    ctx.fillText(`${i + 1} · ${pl.name}${pl.owner === state.myId ? " (you)" : ""}`, pad, ch * 0.065, fieldW);
    ctx.font = `${font * 0.85}px system-ui`;
    ctx.fillStyle = "#d3e4ee";
    ctx.fillText(`${cargo} cargo  /  ${pl.score} pts`, pad, ch * 0.115);
    ctx.strokeStyle = "#263c50";
    ctx.lineWidth = 1;
    for (let lane = 1; lane < 5; lane++) {
      ctx.beginPath(); ctx.moveTo(px(lane * 200), top); ctx.lineTo(px(lane * 200), py(960)); ctx.stroke();
    }
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(pad, py(900)); ctx.lineTo(cw - pad, py(900)); ctx.stroke();
    ctx.setLineDash([]);
    for (const [, dx, dy, value] of snap.o) {
      const radius = Math.max(7, fieldW * 0.035);
      ctx.save(); ctx.translate(px(dx), py(dy));
      ctx.fillStyle = value < 0 ? "#ff6078" : value === 3 ? "#ffcd66" : "#62e8ef";
      ctx.beginPath();
      if (value < 0) ctx.arc(0, 0, radius, 0, Math.PI * 2);
      else { ctx.moveTo(0, -radius * 1.3); ctx.lineTo(radius, 0); ctx.lineTo(0, radius * 1.3); ctx.lineTo(-radius, 0); ctx.closePath(); }
      ctx.fill();
      ctx.fillStyle = "#102030"; ctx.textAlign = "center";
      ctx.font = `bold ${radius * 1.4}px system-ui`;
      ctx.fillText(value < 0 ? "×" : value === 3 ? "3" : "1", 0, radius * 0.48);
      ctx.restore();
    }
    const bx = px(x), by = py(900), half = fieldW * 0.085;
    ctx.fillStyle = jam ? "#ff6078" : pl.color;
    ctx.beginPath(); ctx.moveTo(bx - half, by); ctx.lineTo(bx + half, by);
    ctx.lineTo(bx + half * 0.7, by + ch * 0.035); ctx.lineTo(bx - half * 0.7, by + ch * 0.035); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#f0f6ff"; ctx.textAlign = "center";
    ctx.font = `${font * 0.8}px system-ui`;
    const event = snap.d.find(e => e[0] === i && e[1] !== 0);
    if (!active || jam || event) ctx.fillText(!active ? "OFFLINE" : jam ? "JAMMED −4" : `+${event[1]}`, bx, by - ch * 0.035);
    ctx.restore();
  });
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
    li.innerHTML = `<span class="swatch" style="background:${pl.color}"></span>${esc(pl.name)} <strong>${pl.score} pts</strong><small>${pl.alive === false ? "offline" : `${pl.cargo || 0} cargo`}</small>`;
    ol.appendChild(li);
  }
  const target = document.createElement("li");
  target.className = "muted";
  target.style.listStyle = "none";
  target.textContent = `First to ${state.target} · unique leader wins`;
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
  for (const code of new Set([...held, ...touches.values()])) {
    const [slot, d] = KEYS[code];
    dirs[slot] += d;
  }
  const changed = dirs[0] !== state.localDirs[0];
  state.localDirs = dirs.map(Math.sign);
  if (!isHost() && changed) {
    const host = state.peers.get(state.hostId);
    if (host) dcSend(host.dc, { t: "i", d: state.localDirs[0] });
  }
}
window.addEventListener("keydown", (e) => {
  if ($("game").hidden || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.code === "Space" && isHost() && state.game && state.game.roundOver) {
    e.preventDefault();
    hostNextRound();
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
for (const button of document.querySelectorAll("[data-direction]")) {
  button.onpointerdown = e => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, button.dataset.direction === "-1" ? "ArrowLeft" : "ArrowRight");
    updateDirs();
  };
  const release = e => { touches.delete(e.pointerId); updateDirs(); };
  button.onpointerup = release;
  button.onpointercancel = release;
  button.onlostpointercapture = release;
}
$("next").onclick = () => { if (isHost() && state.game?.roundOver) hostNextRound(); };

// ---------- lobby UI ----------
$("create").onclick = () => sig({ t: "create", name: myName() });
$("join").onclick = () => sig({ t: "join", room: $("code").value.trim(), name: myName() });
$("start").onclick = () => hostStart();
$("mapsize").onchange = updateMapInfo;
$("local2").onchange = updateMapInfo;
$("copy-link").onclick = async () => {
  try {
    await navigator.clipboard.writeText(`${location.origin}/?room=${state.room}`);
    $("copy-link").textContent = "copied!";
  } catch {
    $("copy-link").textContent = "select the link to copy";
  }
  setTimeout(() => ($("copy-link").textContent = "copy"), 1500);
};
$("name").value = localStorage.getItem("achtung-name") || "";
$("name").onchange = () => localStorage.setItem("achtung-name", $("name").value);

connectWs();
