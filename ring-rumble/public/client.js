// Lobby (WebSocket signaling) + WebRTC star topology + renderer.
// The host tab additionally runs the simulation from game.js.
import { Game, COLORS, TICK_HZ, mapSize, botInput } from "/game.js";

import { ArenaView } from "/renderer.js";

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
  localDirs: [0],
  tickTimer: null,
  target: 5,
  map: mapSize(2),
  practice: false,
  snapshot: null,
};
const isHost = () => state.myId && state.myId === state.hostId;
window.rumble = state;

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
const sig = (msg) => {
  if (state.ws?.readyState === 1) state.ws.send(JSON.stringify(msg));
  else setStatus("Connecting to room server… Try again in a moment.");
};
function myName() {
  let n = $("name").value.trim();
  if (!n) {
    try { n = localStorage.getItem("rumble-name"); } catch {}
    n ||= `player-${Math.random().toString(36).slice(2, 5)}`;
    $("name").value = n;
    try { localStorage.setItem("rumble-name", n); } catch {}
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
      if (state.peers.get(msg.id)?.dc?.readyState === "open" && state.players.length) return;
      dropPeer(msg.id);
      return;
    case "host-left":
      if (state.peers.get(state.hostId)?.dc?.readyState === "open" && state.players.length) {
        setStatus("Room closed. Your fight continues.");
        return;
      }
      setStatus("host left the room");
      stopGame();
      $("game").hidden = true;
      $("lobby").hidden = false;
      $("room-info").hidden = true;
      $("create").disabled = false;
      $("join").disabled = false;
      state.peers.clear();
      state.players = [];
      state.room = null;
      history.replaceState(null, "", location.pathname);
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
  let lastSeen = performance.now();
  let heartbeat;
  dc.onopen = () => {
    lastSeen = performance.now();
    heartbeat = setInterval(() => {
      if (performance.now() - lastSeen > 10000) {
        channelClosed();
        peer.pc.close();
      } else dcSend(dc, { t: "ping" });
    }, 2000);
    renderRtc();
    if (!isHost()) dcSend(dc, { t: "hello", name: myName() });
    if (isHost() && state.game) {
      dcSend(dc, { t: "lobby", players: state.players, target: state.target, map: state.map });
      dcSend(dc, { t: "round", n: state.game.round });
      dcSend(dc, state.game.snapshot());
      if (state.game.roundOver) dcSend(dc, { t: "over", winner: state.game.winner(state.target), roundWinner: state.game.roundWinner });
    }
  };
  function channelClosed() {
    clearInterval(heartbeat);
    renderRtc();
    if (isHost() && state.game) {
      for (const pl of state.players) if (pl.owner === id) killPlayer(pl.pid);
    } else if (id === state.hostId && state.players.length) {
      showBanner("Host disconnected. Reload to start a new room.");
      $("next").hidden = true;
    }
  }
  dc.onclose = channelClosed;
  dc.onmessage = (ev) => {
    lastSeen = performance.now();
    const msg = JSON.parse(ev.data);
    if (msg.t === "ping") return dcSend(dc, { t: "pong" });
    if (msg.t !== "pong") onGameMessage(id, msg);
  };
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
      if (pl) state.inputs[pl.pid] = (msg.d | 0) & 63;
    }
    return;
  }
  if (from === state.hostId) applyMessage(msg);
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
      return;
    case "over": {
      const champion = msg.winner >= 0;
      const name = state.players[champion ? msg.winner : msg.roundWinner]?.name;
      showBanner(name ? `${name} wins ${champion ? "the match!" : "the round!"}` : "Draw!");
      $("next").hidden = !isHost();
      $("next").textContent = champion ? "Rematch · Space" : "Next round · Space";
      $("round-hint").textContent = isHost() ? "Ready for another?" : "Waiting for the host…";
      return;
    }
  }
}

// ---------- host loop ----------
function hostStart() {
  if (!isHost()) return;
  const players = [];
  const add = (owner, name, bot = false) => players.push({ pid: players.length, owner, slot: 0, name, bot, color: COLORS[players.length], score: 0 });
  add(state.myId, myName());
  if (state.practice) add("bot", "Sparring bot", true);
  else for (const [id, p] of state.peers) {
    if (id !== state.myId && p.dc?.readyState === "open" && players.length < 8) add(id, p.name);
  }
  if (players.length < 2) return setStatus("Invite a friend and wait for their connection, or try Practice.");
  stopGame();
  state.players = players;
  state.target = 5;
  state.map = mapSize(players.length);
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
  if (!g || (!g.roundOver && g.round > 0)) return;
  if (g.winner(state.target) >= 0) return hostStart();
  g.startRound();
  const msg = { t: "round", n: g.round };
  broadcastGame(msg);
  applyMessage(msg);
  const snap = g.snapshot();
  broadcastGame(snap);
  applyMessage(snap);
}

function hostTick() {
  const g = state.game;
  if (!g || g.roundOver) return;
  for (const pl of state.players) {
    if (pl.owner === state.myId) state.inputs[pl.pid] = state.localDirs[0];
    if (pl.bot) state.inputs[pl.pid] = botInput(g, pl.pid);
  }
  const snap = g.step(state.inputs);
  broadcastGame(snap);
  applyMessage(snap);
  if (snap.over) {
    const over = { t: "over", winner: g.winner(state.target), roundWinner: g.roundWinner };
    broadcastGame(over);
    applyMessage(over);
  }
}

function killPlayer(pid) {
  state.inputs[pid] = 0;
  state.game.disconnect(pid);
}

function stopGame() {
  clearInterval(state.tickTimer);
  state.tickTimer = null;
  state.game = null;
}

// ---------- rendering ----------
let view;
try {
  view = new ArenaView($("scene"));
} catch (error) {
  $("graphics-error").hidden = false;
  $("graphics-error").textContent = "3D graphics are unavailable. Enable WebGL or try another browser.";
  console.error(error);
  for (const id of ["start", "practice"]) $(id).disabled = true;
}

function setArena(map) {
  state.map = map;
  view?.setup(map, state.players, state.myId);
}

function updateMapInfo() {
  let n = 1;
  for (const [id, p] of state.peers) if (id !== state.myId && p.dc?.readyState === "open") n++;
  $("mapinfo").textContent = `${n} / 8 fighters ready`;
  $("start").disabled = n < 2 || !view;
}

function enterGame() {
  $("scores").replaceChildren();
  $("lobby").hidden = true;
  $("hero-copy").hidden = true;
  $("game").hidden = false;
  $("stage").classList.add("playing");
  $("practice").hidden = true;
  renderScores();
}

function startRoundView(n) {
  state.snapshot = null;
  $("round-number").textContent = `ROUND ${String(n).padStart(2, "0")}`;
  $("next").hidden = true;
  $("round-hint").textContent = "";
  $("banner").hidden = true;
  for (const pl of state.players) pl.alive = true;
  held.clear();
  touchHeld.clear();
  updateDirs();
  renderScores();
}

function drawSnapshot(snap) {
  state.snapshot = snap;
  view?.draw(snap);
  snap.p.forEach((p, i) => {
    state.players[i].alive = !!p[4];
    state.players[i].damage = p[3];
    state.players[i].score = snap.scores[i];
  });
  renderScores();
  $("clock").textContent = snap.f > 0 ? "GET READY" : `${Math.max(0, 60 - Math.floor(snap.k / TICK_HZ))}s`;
  if (snap.f > 0) showBanner(String(Math.ceil(snap.f / TICK_HZ)));
  else if (!snap.over) {
    $("banner").hidden = true;
    $("round-hint").textContent = snap.k >= 600 ? "The ring is shrinking. Stay inside!" : "Knock them off. Stay on.";
  }
  const own = state.players.findIndex(p => p.owner === state.myId);
  $("dash-status").textContent = own < 0 ? "Spectating · join the next match" : snap.p[own][4] === 0 ? "You’re out · watch the fight" : snap.p[own][7] ? `Dash ${ (snap.p[own][7] / TICK_HZ).toFixed(1) }s` : "Dash ready";
}

function showBanner(text) {
  $("banner").textContent = text;
  $("banner").hidden = false;
}

function renderScores() {
  const ol = $("scores");
  if (ol.children.length !== state.players.length) {
    ol.replaceChildren(...state.players.map(pl => {
      const li = document.createElement("li");
      li.style.setProperty("--fighter", pl.color);
      li.innerHTML = `<span class="swatch"></span><span class="fighter-name">${esc(pl.name)}${pl.owner === state.myId ? " <small>YOU</small>" : ""}</span><strong class="damage"></strong><span class="wins"></span>`;
      return li;
    }));
  }
  state.players.forEach((pl, i) => {
    const li = ol.children[i];
    li.classList.toggle("dead", pl.alive === false);
    li.querySelector(".damage").textContent = pl.alive === false ? "OUT" : `${pl.damage || 0}%`;
    li.querySelector(".wins").textContent = `${pl.score} / ${state.target}`;
  });
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
const KEYS = { ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2, ArrowUp: 4, KeyW: 4, ArrowDown: 8, KeyS: 8, KeyJ: 16, KeyK: 32, ShiftLeft: 32, ShiftRight: 32 };
const held = new Set();
const touchHeld = new Map();
function updateDirs() {
  let mask = 0;
  for (const code of held) mask |= KEYS[code];
  for (const value of touchHeld.values()) mask |= value;
  if (mask === state.localDirs[0]) return;
  state.localDirs = [mask];
  if (!isHost()) dcSend(state.peers.get(state.hostId)?.dc, { t: "i", d: mask });
}
window.addEventListener("keydown", e => {
  if (e.target.matches("input, textarea, select") || $("game").hidden) return;
  if (e.code === "Space" && isHost() && state.game?.roundOver && !e.repeat) {
    e.preventDefault();
    hostNextRound();
  } else if (KEYS[e.code]) {
    e.preventDefault();
    held.add(e.code);
    updateDirs();
  }
});
window.addEventListener("keyup", e => { held.delete(e.code); updateDirs(); });
function releaseControls() { held.clear(); touchHeld.clear(); updateDirs(); }
window.addEventListener("blur", releaseControls);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseControls(); });
for (const button of document.querySelectorAll("[data-input]")) {
  button.onpointerdown = e => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    touchHeld.set(e.pointerId, Number(button.dataset.input));
    updateDirs();
  };
  const release = e => { touchHeld.delete(e.pointerId); updateDirs(); };
  button.onpointerup = release;
  button.onpointercancel = release;
  button.onlostpointercapture = release;
}

// ---------- lobby UI ----------
$("create").onclick = () => sig({ t: "create", name: myName() });
$("join").onclick = () => sig({ t: "join", room: $("code").value.trim(), name: myName() });
$("start").onclick = () => hostStart();
$("next").onclick = () => hostNextRound();
$("practice").onclick = () => {
  state.practice = true;
  if (state.ws) { state.ws.onmessage = null; state.ws.onclose = null; state.ws.close(); }
  for (const p of state.peers.values()) p.pc?.close();
  state.peers.clear();
  state.myId = state.hostId = "practice";
  state.peers.set("practice", { name: myName() });
  setStatus("Practice · you + bot");
  hostStart();
};
$("copy-link").onclick = async () => {
  try {
    await navigator.clipboard.writeText(`${location.origin}/?room=${state.room}`);
    $("copy-link").textContent = "Copied!";
    setTimeout(() => ($("copy-link").textContent = "Copy link"), 1500);
  } catch { setStatus("Select the invite link to copy it."); }
};
try { $("name").value = localStorage.getItem("rumble-name") || ""; } catch {}
$("name").onchange = () => { try { localStorage.setItem("rumble-name", $("name").value); } catch {} };

connectWs();
