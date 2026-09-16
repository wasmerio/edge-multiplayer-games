// Lobby (WebSocket signaling) + WebRTC star topology + renderer.
// The host tab additionally runs the simulation from game.js.
import { Game, COLORS, TICK_HZ, MAP, TEAMS, RULES, WEAPONS, SHOP, cleanInput } from "/game.js";
import { FirstPersonView } from "/renderer.js";

const $ = (id) => document.getElementById(id);
const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

const state = {
  ws: null,
  myId: null,
  hostId: null,
  room: null,
  peers: new Map(), // peerId -> { name, pc, dc }
  players: [], // [{ pid, owner, name, color }]
  game: null,
  inputs: [],
  localInput: [0, 0, 0],
  snapshot: null,
  teamScores: [0, 0],
  tickTimer: null,
  target: 5,
  map: { ...MAP },
};
const isHost = () => state.myId && state.myId === state.hostId;
window.breach = state;

// ---------- signaling ----------
function connectWs() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => {
    setStatus("connected");
    $("create").disabled = false; $("join").disabled = false;
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
    n = localStorage.getItem("breach-name") || `player-${Math.random().toString(36).slice(2, 5)}`;
    $("name").value = n;
    try { localStorage.setItem("breach-name", n); } catch {}
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
      if (state.peers.get(msg.id)?.dc?.readyState === "open") return;
      dropPeer(msg.id);
      return;
    case "host-left":
      if (state.peers.get(state.hostId)?.dc?.readyState === "open") { setStatus("signaling closed · match continues"); return; }
      setStatus("host left the room · reload to create a room");
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
  pc.onconnectionstatechange = () => {
    renderRtc();
    if (pc.connectionState === "failed") channelLost(id);
  };
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
    else if (state.game) {
      dcSend(dc, {t:"lobby", players:state.players, target:state.target, map:state.map});
      dcSend(dc, {t:"round", n:state.game.round});
      dcSend(dc, state.game.snapshot());
      if (state.game.roundOver) dcSend(dc, overMessage());
    }
  };
  dc.onclose = () => { renderRtc(); channelLost(id); };
  dc.onmessage = (ev) => {
    try { onGameMessage(id, JSON.parse(ev.data)); } catch (error) { console.warn("Invalid game message", error); }
  };
}
const dcSend = (dc, msg) => dc && dc.readyState === "open" && dc.send(JSON.stringify(msg));
function broadcastGame(msg) {
  const encoded = JSON.stringify(msg);
  for (const p of state.peers.values()) if (p.dc?.readyState === 'open') p.dc.send(encoded);
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
function channelLost(id) {
  if (isHost() && state.game) {
    for (const pl of state.players) if (pl.owner === id) killPlayer(pl.pid);
  } else if (id === state.hostId && state.snapshot) {
    showBanner('Host disconnected', 'Reload to join a new room.');
  }
}
function onGameMessage(from, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (isHost()) {
    if (msg.t === 'hello') {
      state.peers.get(from).name = String(msg.name).slice(0, 16);
      renderPeers();
    } else if (msg.t === 'buy' && state.game) {
      const pl = state.players.find(p => p.owner === from);
      if (pl) purchase(pl.pid, msg.item, from);
    } else if (msg.t === 'i' && state.game) {
      const pl = state.players.find(p => p.owner === from);
      if (pl) state.inputs[pl.pid] = cleanInput(msg.i);
    }
    return;
  }
  if (from === state.hostId) applyMessage(msg);
}
function applyMessage(msg) {
  switch (msg.t) {
    case 'lobby':
      state.players = msg.players; state.target = msg.target;
      state.map = msg.map; $('lobby').hidden = true; $('game').hidden = false;
      view?.setup(state.players, myIndex()); view?.resize();
      $('room-tag').textContent = `ROOM ${state.room}`;
      return;
    case 'round':
      state.round = msg.n; state.snapshot = null; aim = myIndex()%2 ? 180 : 0; pitch = 0; clearInput();
      state.autoBuyRound = 0; view?.clearEffects();
      $('banner').hidden = true; $('next').hidden = true; $('killfeed').textContent = '';
      $('round-label').textContent = `ROUND ${String(msg.n).padStart(2, '0')}`;
      return;
    case 's':
      state.snapshot = msg; state.teamScores = msg.scores;
      drawSnapshot(msg); renderScores(); return;
    case 'purchase':
      $('buy-feedback').textContent = msg.reason;
      return;
    case 'frame':
      if (!$('game').hidden && !document.hidden) {
        view?.render(msg.now, state.localInput, ads);
        $('crosshair').classList.toggle('hit', msg.now < (view?.hitUntil || 0));
      }
      return;
    case 'over':
      setBuy(false); document.exitPointerLock?.();
      showBanner(msg.winner < 0 ? `${TEAMS[msg.team]} win the round` : `${TEAMS[msg.winner]} win the match`,
        `${msg.reason} · ${isHost() ? 'Press Space to ' + (msg.winner < 0 ? 'continue' : 'play again') : 'Waiting for host'}`);
      $('next').hidden = !isHost(); $('next').textContent = msg.winner < 0 ? 'Next round →' : 'Play again →';
      return;
  }
}
function overMessage() {
  return {t:'over', winner:state.game.winner(state.target), team:state.game.result[0], reason:state.game.result[1]};
}
function hostStart() {
  if (!isHost()) return;
  const connected = [...state.peers].filter(([id, p]) => id === state.myId || p.dc?.readyState === 'open');
  if (connected.length < 2) { setStatus('Invite a friend. A match needs at least two connected players.'); return; }
  stopGame();
  state.players = connected.map(([owner, p], pid) => ({pid, owner, name:p.name, color:COLORS[pid % 2]}));
  state.game = new Game(state.players.length); state.inputs = state.players.map((_, i) => [0, i%2 ? 180 : 0, 0]);
  state.localInput = [0, 0, 0]; state.map = {...MAP};
  const lobby = {t:'lobby', players:state.players, target:state.target, map:state.map};
  broadcastGame(lobby); applyMessage(lobby); hostNextRound();
  let last = performance.now(), acc = 0;
  const dt = 1000 / TICK_HZ;
  state.tickTimer = setInterval(() => {
    const now = performance.now(); acc += Math.min(250, now - last); last = now;
    while (acc >= dt) { acc -= dt; hostTick(); }
  }, dt / 2);
}
function hostNextRound() {
  if (!isHost() || !state.game) return;
  const g = state.game;
  if (g.winner(state.target) >= 0) { hostStart(); return; }
  if (!g.roundOver) return;
  g.startRound(); state.inputs = state.players.map((_, i) => [0, i%2 ? 180 : 0, 0]);
  const msg = {t:'round', n:g.round}; broadcastGame(msg); applyMessage(msg);
}
function hostTick() {
  const g = state.game;
  if (!g || g.roundOver) return;
  for (const pl of state.players) if (pl.owner === state.myId) state.inputs[pl.pid] = state.localInput;
  const snap = g.step(state.inputs); broadcastGame(snap); applyMessage(snap);
  if (snap.over) { const msg = overMessage(); broadcastGame(msg); applyMessage(msg); }
}
function killPlayer(pid) { state.game?.disconnect(pid); }
function stopGame() { clearInterval(state.tickTimer); state.tickTimer = null; state.game = null; }

// ---------- rendering ----------
const myIndex = () => state.players.findIndex(p => p.owner === state.myId);
function setText(id, value) {
  const element = $(id), text = String(value);
  if (element.textContent !== text) element.textContent = text;
}
let view;
try { view = new FirstPersonView($('scene')); state.view = view; }
catch { $('graphics-error').hidden = false; $('graphics-error').textContent = 'WebGL is unavailable. Enable hardware acceleration or use a browser with WebGL support.'; }
function drawSnapshot(s) {
  view?.update(s);
  const mine = myIndex(), me = s.p[mine], weapon = WEAPONS[me?.[8] || 0];
  const [mode,carrier,,,ticks] = s.b;
  const seconds = Math.ceil((s.freeze > 0 ? s.freeze : mode === 1 ? ticks : Math.max(0,s.left))/TICK_HZ);
  setText('timer', `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`);
  $('timer').classList.toggle('danger', mode === 1);
  setText('attack-score', s.scores[0]); setText('defend-score', s.scores[1]);
  setText('health', me ? `${me[3]}` : '—'); setText('ammo', me ? `${me[4]} / ${weapon.magazine}` : '—');
  setText('weapon-label', weapon.name); setText('armor', me?.[10] || 0);
  setText('money', me ? `$${me[9].toLocaleString()}` : '—');
  setText('team-label', mine < 0 ? 'SPECTATOR' : TEAMS[mine%2].toUpperCase());
  $('team-label').style.color = COLORS[mine%2] || '#fff';
  let objective = mode === 1 ? `BOMB PLANTED · ${mine%2 === 1 ? 'Hold E near the bomb to defuse' : 'Protect the bomb'}` : mine%2 === 0 ? (carrier === mine ? 'You have the bomb · Hold E at A or B to plant' : 'Cover your carrier · Take a bombsite') : 'Defend A and B · Stop the attackers';
  if (mine < 0) objective = 'Spectating · You can play in the next match';
  else if (me[3] <= 0) objective = 'Eliminated · Watching your team';
  else if (s.freeze > 0) objective = `BUY PERIOD · ${Math.ceil(s.freeze/TICK_HZ)}s · B to buy weapons and equipment`;
  else if (me[5]) objective = 'Reloading…';
  setText('objective', objective);
  const defuse = me?.[11] ? RULES.kitDefuse : RULES.defuse;
  const progress = me?.[6] ? me[6]/(mine%2 ? defuse : RULES.plant) : me?.[5] ? 1-me[5]/weapon.reload : 0;
  $('action-progress').style.width = `${progress*100}%`;
  setText('kit-status', me?.[11] ? 'DEFUSE KIT' : '');
  if (s.d.length) setText('killfeed', s.d.map(i => `${state.players[i].name} eliminated`).join(' · '));
  $('buy-toggle').disabled = !me || me[3]<=0 || !s.freeze || s.over;
  if (s.freeze > 0 && !s.over && me?.[3]>0 && state.autoBuyRound !== state.round) {
    state.autoBuyRound = state.round; setBuy(true);
  }
  if (!s.freeze || s.over || !me || me[3]<=0) setBuy(false);
  updateBuy(); updatePointerHint();
}
function purchase(pid, item, owner) {
  const response = {t:'purchase', ...state.game.buy(pid, item)};
  if (owner === state.myId) applyMessage(response);
  else dcSend(state.peers.get(owner)?.dc, response);
  const snapshot = state.game.snapshot(); broadcastGame(snapshot); applyMessage(snapshot);
}
function setBuy(open) {
  if (open && (!$('banner').hidden || !state.snapshot?.freeze || state.snapshot?.over || !state.snapshot?.p[myIndex()]?.[3])) return;
  if ($('buy-menu').hidden === !open) return;
  $('buy-menu').hidden = !open;
  if (open) { clearInput(); document.exitPointerLock?.(); $('buy-feedback').textContent = ''; $('buy-close').focus(); }
  updatePointerHint();
}
function updateBuy() {
  if ($('buy-menu').hidden) return;
  const me=state.snapshot?.p[myIndex()];
  setText('buy-balance', me ? `$${me[9].toLocaleString()}` : '$0');
  setText('buy-time', `${Math.ceil((state.snapshot?.freeze || 0)/TICK_HZ)}s remaining`);
  for (const button of $('buy-items').children) {
    const item=SHOP.find(item=>item.id===button.dataset.item), weapon=WEAPONS.findIndex(w=>w.id===item.id);
    const owned=me && (weapon===me[8] || item.id==='armor' && me[10]===100 || item.id==='kit' && me[11]);
    const restricted=item.id==='kit' && myIndex()%2===0;
    button.disabled = !me || owned || restricted || me[9]<item.price || !state.snapshot.freeze || state.snapshot.over;
    const status = owned?'EQUIPPED':restricted?'DEFENDERS ONLY':me && me[9]<item.price?'INSUFFICIENT FUNDS':'BUY →';
    const label = button.querySelector('.buy-state');
    if (label.textContent !== status) label.textContent = status;
  }
}
for (const [i,item] of SHOP.entries()) {
  const button=document.createElement('button'); button.className='buy-item'; button.dataset.item=item.id;
  const top=document.createElement('span'); top.className='item-top';
  const number=document.createElement('span'); number.textContent=`0${i+1} / ${i<4?'WEAPON':'EQUIPMENT'}`;
  const price=document.createElement('b'); price.textContent=item.price?`$${item.price.toLocaleString()}`:'FREE'; top.append(number,price);
  const name=document.createElement('strong'); name.textContent=item.name;
  const note=document.createElement('span'); note.className='item-note'; note.textContent=item.note;
  const status=document.createElement('span'); status.className='buy-state'; status.textContent='BUY →';
  button.append(top,name,note,status); button.onclick=()=>{
    if(isHost()) purchase(myIndex(),item.id,state.myId);
    else { $('buy-feedback').textContent='Purchasing…'; dcSend(state.peers.get(state.hostId)?.dc,{t:'buy',item:item.id}); }
  }; $('buy-items').append(button);
}
$('buy-toggle').onclick=()=>setBuy(true); $('buy-close').onclick=()=>setBuy(false);
let lastFrame = 0;
function frame(now) {
  const interval = $('buy-menu').hidden && $('banner').hidden ? 1000/60 : 1000/15;
  if (now-lastFrame >= interval-1) { applyMessage({t:'frame',now}); lastFrame=now; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
function showBanner(title, subtitle) { $('banner-title').textContent=title; $('banner-subtitle').textContent=subtitle; $('banner').hidden=false; }
let scoreSignature = '';
function renderScores() {
  const signature = JSON.stringify([state.myId,state.players,state.snapshot?.p.map(p=>[p[3]===0,p[7]])]);
  if (signature === scoreSignature) return;
  scoreSignature = signature;
  $('scores').replaceChildren();
  for (const [i,p] of state.players.entries()) {
    const li=document.createElement('li'); li.className=state.snapshot?.p[i][3]===0 ? 'dead' : '';
    const dot=document.createElement('span'); dot.className='swatch'; dot.style.background=COLORS[i%2];
    li.append(dot, document.createTextNode(`${p.name}${p.owner===state.myId?' (you)':''}`));
    const score=document.createElement('b'); score.textContent=state.snapshot?.p[i][7] || 0; li.append(score); $('scores').append(li);
  }
}
function renderPeers() {
  $('peers').replaceChildren();
  [...state.peers].forEach(([id,p],i) => {
    const li=document.createElement('li');
    li.textContent=`${p.name}${id===state.myId?' (you)':''} · ${TEAMS[i%2]}${id===state.hostId?' · host':''}`;
    li.style.borderLeftColor=COLORS[i%2]; $('peers').append(li);
  }); renderRtc();
}
function renderRtc() {
  const details=[...state.peers].filter(([id,p]) => id!==state.myId && p.pc).map(([,p])=>`${p.name}: ${p.pc.connectionState}/${p.dc?.readyState || '—'}`);
  $('rtc').textContent=details.join(' · '); $('connection-detail').textContent=details.join(' · ') || 'Waiting for a friend to connect';
  if (isHost()) $('start').disabled = ![...state.peers.values()].some(p=>p.dc?.readyState==='open');
}
function showRoom() {
  $('room-info').hidden=false; $('room-code').textContent=state.room;
  $('host-controls').hidden=!isHost(); $('wait').hidden=isHost();
  $('create').disabled=true; $('join').disabled=true;
  history.replaceState(null,'',`?room=${state.room}`);
  const link=`${location.origin}/?room=${state.room}`;
  $('invite-link').textContent=link; $('invite-link').href=link; $('invite').hidden=!isHost(); renderPeers();
}
const setStatus = text => $('status').textContent=text;

// ---------- input ----------
const held=new Set(); let firing=false, ads=false, aim=0, pitch=0;
let pendingInput = null, inputTimer = null, lastInputSent = -Infinity;
function sendInput() {
  clearTimeout(inputTimer); inputTimer = null;
  if (!pendingInput) return;
  const dc = state.peers.get(state.hostId)?.dc;
  if (dc?.readyState !== 'open') { pendingInput = null; return; }
  if (dc.bufferedAmount > 4096) { inputTimer = setTimeout(sendInput, 1000/TICK_HZ); return; }
  dcSend(dc, {t:'i', i:pendingInput});
  pendingInput = null; lastInputSent = performance.now();
}
const KEYS={KeyA:1,ArrowLeft:1,KeyD:2,ArrowRight:2,KeyW:4,ArrowUp:4,KeyS:8,ArrowDown:8,KeyR:32,KeyE:64};
function updateInput() {
  let bits=firing?16:0; for (const key of held) bits|=KEYS[key];
  const input=cleanInput([bits,aim,pitch]);
  if (input.every((n,i)=>n===state.localInput[i])) return;
  const buttonsChanged = input[0] !== state.localInput[0];
  state.localInput=input;
  if (!isHost()) {
    pendingInput = input;
    if (buttonsChanged) sendInput();
    else if (!inputTimer) inputTimer = setTimeout(sendInput, Math.max(0, 1000/TICK_HZ-(performance.now()-lastInputSent)));
  }
}
function clearInput() { held.clear(); firing=false; ads=false; updateInput(); }
function updatePointerHint() {
  const me=state.snapshot?.p[myIndex()], active=me?.[3]>0 && !state.snapshot.over;
  $('pointer-hint').hidden = !active || !$('buy-menu').hidden || document.pointerLockElement === $('scene');
  $('crosshair').hidden = !active || !$('buy-menu').hidden;
}
window.addEventListener('keydown',e=>{
  if ($('game').hidden || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.code==='KeyB' && !e.repeat) { e.preventDefault(); setBuy($('buy-menu').hidden); return; }
  if (e.code==='Escape') { setBuy(false); clearInput(); return; }
  if (e.code==='Space' && isHost() && state.game?.roundOver) { e.preventDefault(); hostNextRound(); return; }
  if (KEYS[e.code] && $('buy-menu').hidden && document.pointerLockElement===$('scene')) { e.preventDefault(); held.add(e.code); updateInput(); }
});
window.addEventListener('keyup',e=>{ if (KEYS[e.code]) { held.delete(e.code); updateInput(); } });
window.addEventListener('blur',clearInput);
document.addEventListener('visibilitychange',()=>{ if (document.hidden) clearInput(); });
document.addEventListener('pointerlockchange',()=>{ if(document.pointerLockElement!==$('scene')) clearInput(); updatePointerHint(); });
document.addEventListener('mousemove',e=>{
  if(document.pointerLockElement!==$('scene') || !$('buy-menu').hidden) return;
  // Ignore cursor warps when the browser captures the mouse again.
  if(Math.abs(e.movementX)>500 || Math.abs(e.movementY)>500) return;
  const sensitivity=ads?0.075:0.14;
  aim=(aim+e.movementX*sensitivity+360)%360; pitch=Math.max(-75,Math.min(75,pitch-e.movementY*sensitivity)); updateInput();
});
function updateMouseButtons(e) {
  const active = document.pointerLockElement === $('scene') && $('buy-menu').hidden
    && !state.snapshot?.over && state.snapshot?.p[myIndex()]?.[3] > 0;
  firing = active && (e.buttons & 1) !== 0;
  ads = active && (e.buttons & 2) !== 0;
  updateInput();
}
// Mouse events report every button change, including overlapping presses.
$('scene').addEventListener('mousedown',async e=>{
  if(!$('buy-menu').hidden || state.snapshot?.over || !state.snapshot?.p[myIndex()]?.[3]) return;
  if(document.pointerLockElement!==$('scene')) {
    try { await $('scene').requestPointerLock(); } catch { $('pointer-hint').textContent='Click to capture the mouse. Escape releases it.'; } return;
  }
  e.preventDefault();
  updateMouseButtons(e);
});
window.addEventListener('mouseup',updateMouseButtons);
$('scene').addEventListener('pointercancel',clearInput);
$('scene').addEventListener('contextmenu',e=>e.preventDefault());
$('create').onclick=()=>sig({t:'create',name:myName()});
$('join').onclick=()=>sig({t:'join',room:$('code').value.trim(),name:myName()});
$('start').onclick=hostStart; $('next').onclick=()=>{ hostNextRound(); $('next').blur(); };
$('copy-link').onclick=async()=>{
  try { await navigator.clipboard.writeText(`${location.origin}/?room=${state.room}`); $('copy-link').textContent='Copied!'; }
  catch { $('copy-link').textContent='Select and copy the link'; }
};
try { $('name').value=localStorage.getItem('breach-name') || ''; } catch {}
$('name').onchange=()=>{ try { localStorage.setItem('breach-name',$('name').value); } catch {} };
connectWs();
