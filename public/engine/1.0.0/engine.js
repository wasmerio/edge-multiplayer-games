// The façade a game imports. A game brings a simulation, a snapshot schema, an
// intent and a draw function; the engine brings everything else.
export { defineSnapshot } from "./schema.js";
export { seededRng } from "./rng.js";
export { record, replay, finalState, parseFixture } from "./replay.js";
export { validateSimulation } from "./sim.js";
export { fixedTick } from "./loop.js";
export { createBuffer } from "./interp.js";
export { createSurface, arenaFor } from "./render2d.js";
export { inputSource } from "./input.js";
export { mountUi } from "./ui.js";
export { createMixer, createWebAudio } from "./audio.js";
export { createCollector, meterTransport, sparkline } from "./diagnostics.js";
export { loadAssets, manifestUrl, manifestUrlFor, auditLedger, SOUND_NAMES } from "./assets.js";
export { workerTimers } from "./clock.js";
export { PLAYER_COLOURS, colourFor } from "./palette.js";
export { hostGame } from "./host.js";
export { joinGame } from "./guest.js";
export { connectSignal } from "./signal.js";
export { createStar, ICE } from "./rtc.js";
export { createStage } from "./stage.js";
export * as params from "./params.js";

import { defineSnapshot } from "./schema.js";
import { validateSimulation } from "./sim.js";
import { seededRng } from "./rng.js";
import { createSurface, arenaFor } from "./render2d.js";
import { inputSource } from "./input.js";
import { mountUi } from "./ui.js";
import { createMixer, createWebAudio } from "./audio.js";
import { createCollector, meterTransport } from "./diagnostics.js";
import { loadAssets, manifestUrlFor, SOUND_NAMES } from "./assets.js";
import { workerTimers } from "./clock.js";
import { colourFor, PLAYER_COLOURS } from "./palette.js";
import { hostGame } from "./host.js";
import { joinGame } from "./guest.js";
import { connectSignal } from "./signal.js";
import { createStar } from "./rtc.js";
import { createStage } from "./stage.js";
import { DEFAULT_TICK_HZ, ENGINE_VERSION, MAX_PLAYERS_PER_ROOM } from "./params.js";

export function startGame(config) {
  const {
    title, Simulation, schema, intent, bindings, draw, mount, scoreboard, onCommand,
    minPlayers = 1,
    touchControls = [], audioMap = {}, audioAssets = {},
    arena = (players) => arenaFor(players),
    target = (players) => Math.max(5, 10 * (players - 1)),
    tickHz = DEFAULT_TICK_HZ,
    container = globalThis.document?.getElementById("game") || globalThis.document?.body,
    doc = globalThis.document, where = globalThis.location, history = globalThis.history,
  } = config;

  validateSimulation(Simulation, { arena: arena(2) });
  if (!schema?.hash) throw new Error("startGame: schema must come from defineSnapshot");
  if (typeof mount !== "function" && typeof draw !== "function") throw new Error("startGame: draw must be a function");

  const diagnostics = createCollector({ enabled: new URLSearchParams(where?.search || "").get("overlay") === "1" });
  const locator = { origin: where.origin, search: where.search, replaceState: (a, b, c) => history?.replaceState(a, b, c) };

  const ui = mountUi({
    container, title, doc, where: locator, touchControls, intent,
    onOverlay: (on) => diagnostics.enable(on),
    onCreate: (name) => signal.send({ t: "create", name, schema: schema.hash }),
    onJoin: (room, name) => signal.send({ t: "join", room, name, token: tokenFor(room), schema: schema.hash }),
    onStart: () => {
      const ready = 1 + (star?.transport.peers().length ?? 0);
      if (ready < minPlayers) { ui.setStatus(`waiting for players: ${ready} of ${minPlayers} connected`); return; }
      signal.send({ t: "start" });
    },
    onTouch: (field, value) => input.touch(field, value),
  });

  // Sounds come from the shared asset set and load after the first gesture, when audio is allowed.
  const mapped = [...new Set(Object.values(audioMap).map((b) => (typeof b === "string" ? b : b?.sound)))];
  const audio = config.audioContext ?? (mapped.length ? createWebAudio() : null);
  const mixer = createMixer({ assets: audioAssets, names: SOUND_NAMES, map: audioMap, context: audio });
  // Pitch variation has its own generator, so sound never disturbs the simulation's sequence.
  const audioRng = seededRng(1);
  const sounds = { wanted: mapped.filter((name) => !(name in audioAssets)), loaded: [], failures: {} };
  const loadSounds = () => {
    if (!sounds.wanted.length || !audio?.decode) return;
    const wanted = sounds.wanted.splice(0);
    loadAssets(config.assetsUrl ?? manifestUrlFor(import.meta.url), wanted, { decodeAudio: (bytes) => audio.decode(bytes) })
      .then((result) => { mixer.addAssets(result.assets); sounds.loaded.push(...Object.keys(result.assets)); Object.assign(sounds.failures, result.failures); })
      .catch((error) => { sounds.failures.manifest = error.message; });
  };
  ui.setMuteLabel(mixer.muted());
  ui.onMute(() => { mixer.setMuted(!mixer.muted()); ui.setMuteLabel(mixer.muted()); });
  const unlock = () => {
    mixer.unlock();
    audio?.resume?.()?.catch?.(() => {});
    loadSounds();
    doc.removeEventListener("pointerdown", unlock);
    doc.removeEventListener("keydown", unlock);
  };
  doc.addEventListener("pointerdown", unlock);
  doc.addEventListener("keydown", unlock);

  const state = {
    selfId: null, hostId: null, room: null, token: null, spectator: false,
    players: [], target: 0, roster: [], host: null, client: null, snapshot: null, rng: null, retried: false,
    presented: -Infinity, over: false, row: null, loopDropped: 0, timers: null,
  };
  const isHost = () => state.selfId !== null && state.selfId === state.hostId;
  // A seat token belongs to this tab, so it lives in sessionStorage: a reload
  // reclaims the seat, and a second tab on the same origin is a new player.
  const tokenKey = (room) => `engine-token-${room}`;
  const tokenFor = (room) => { try { return globalThis.sessionStorage?.getItem(tokenKey(room)) ?? undefined; } catch { return undefined; } };
  const rememberToken = (room, token) => { try { globalThis.sessionStorage?.setItem(tokenKey(room), token); } catch { /* optional */ } };
  const forgetToken = (room) => { try { globalThis.sessionStorage?.removeItem(tokenKey(room)); } catch { /* optional */ } };

  const input = inputSource({
    intent, bindings,
    onChange: (value) => {
      if (state.spectator) return;
      if (isHost()) {
        const seat = state.players.findIndex((p) => p.owner === state.selfId);
        if (seat >= 0) state.host?.setLocalInput(seat, value);
      } else {
        star?.transport.sendToHost(JSON.stringify({ t: "i", d: value }));
      }
    },
  });
  ui.enableTouch(input.wantsTouchControls() && touchControls.length > 0);

  let star = null;
  const signal = connectSignal({
    url: `${where.protocol === "https:" ? "wss:" : "ws:"}//${where.host}/ws`,
    onStatus: (text) => ui.setStatus(text),
    onMessage: handle,
  });

  function makeStar() {
    star = createStar({
      signal, isHost: isHost(), hostId: state.hostId, selfId: state.selfId,
      onPeerState: (id, what) => {
        renderRoster();
        if (what === "open" && isHost()) state.host?.welcome(id);
      },
    });
    star.transport = meterTransport(star.transport, diagnostics);
  }

  // The peer list carries each peer's channel state, so an open link is visible.
  function renderRoster() {
    const links = star?.states() ?? [];
    ui.renderPeers(state.roster.map((peer) => {
      const link = links.find((entry) => entry.id === peer.id);
      return link ? { ...peer, channel: link.channel === "-" ? "connecting" : link.channel } : peer;
    }));
  }

  function handle(msg) {
    switch (msg.t) {
      case "ready": {
        state.selfId = msg.id;
        ui.setStatus(`connected · engine ${ENGINE_VERSION}`);
        if (ui.contract.room) signal.send({ t: "join", room: ui.contract.room, name: ui.name(), token: tokenFor(ui.contract.room), schema: schema.hash });
        else if (ui.contract.create) signal.send({ t: "create", name: ui.name(), schema: schema.hash });
        return;
      }
      case "created":
        state.hostId = state.selfId;
        state.room = msg.room;
        state.token = msg.token;
        rememberToken(msg.room, msg.token);
        state.roster = [{ id: state.selfId, name: ui.name(), spectator: false, connected: true }];
        makeStar();
        ui.showRoom({ room: msg.room, isHost: true, canStart: true });
        renderRoster();
        return;
      case "joined":
      case "rejoined":
        state.hostId = msg.host;
        state.room = msg.room;
        state.token = msg.token;
        state.spectator = msg.spectator;
        state.roster = msg.peers;
        rememberToken(msg.room, msg.token);
        makeStar();
        ui.showRoom({ room: msg.room, isHost: isHost(), canStart: isHost() });
        renderRoster();
        if (!isHost()) attachGuest();
        return;
      case "peer":
        state.roster = [...state.roster.filter((p) => p.id !== msg.id), { id: msg.id, name: msg.name, spectator: msg.spectator, connected: true }];
        renderRoster();
        if (isHost()) star.connect(msg.id, true);
        return;
      case "leave":
      case "host-absent":
        state.roster = state.roster.map((p) => (p.id === msg.id ? { ...p, connected: false } : p));
        renderRoster();
        if (msg.t === "host-absent") ui.setStatus("host away, waiting for them to return");
        star?.drop(msg.id);
        if (isHost() && msg.t === "leave") state.host?.disconnect(msg.id);
        return;
      case "resumed":
        state.roster = state.roster.map((p) => (p.id === msg.id ? { ...p, connected: true } : p));
        renderRoster();
        if (isHost()) star.connect(msg.id, true);
        return;
      case "signal":
        star?.accept(msg.from, msg.data);
        return;
      case "started":
        if (isHost()) hostStart();
        return;
      case "room-closed":
        ui.setStatus("room closed");
        state.host?.stop();
        return;
      case "error": {
        // A stale token must never cost the player their seat: drop it and
        // join as a new peer instead.
        const retryable = msg.code === "token_in_use" || msg.code === "token_for_another_room";
        const room = state.room || ui.contract.room;
        if (retryable && room && !state.retried) {
          state.retried = true;
          forgetToken(room);
          signal.send({ t: "join", room, name: ui.name(), schema: schema.hash });
          return;
        }
        ui.setStatus(`error: ${msg.code}`);
        return;
      }
      default:
        return;
    }
  }

  function attachGuest() {
    state.client = joinGame({
      schema, transport: star.transport,
      onFrame: ({ bytes, tick }) => { diagnostics.tick(); diagnostics.snapshot(bytes, tick); },
      onRtt: (ms) => diagnostics.rtt(ms),
      onLobby: (lobby) => {
        state.players = lobby.players;
        state.target = lobby.target;
        state.tickHz = lobby.tickHz;
        state.presented = -Infinity;
        diagnostics.configure({ tickHz: lobby.tickHz, budgetBytes: schema.budgetBytes * Math.max(1, lobby.players.length) });
        ui.enterGame();
        renderBoard([]);
        stage.lobby(lobby);
      },
      onRound: (msg) => { state.presented = -Infinity; state.over = false; diagnostics.round(); ui.banner(`Round ${msg.n}`, 1400); stage.round(msg); },
      onControl: (msg) => {
        if (msg.t === "score") renderBoard(msg.scores);
        if (msg.t === "over") { state.over = true; ui.banner(msg.winner < 0 ? "Round over" : `${state.players[msg.winner]?.name} wins`); stage.over(msg); }
        if (msg.t === "c") stage.reply(msg.d);
      },
      onSnapshot: (snapshot) => stage.snapshot(snapshot),
      onError: (error) => ui.setStatus(`error: ${error.code}`),
    }).attach();
  }

  function hostStart() {
    const seats = [{ owner: state.selfId, name: ui.name() }];
    for (const id of star.transport.peers()) {
      const peer = state.roster.find((p) => p.id === id);
      if (peer && !peer.spectator && seats.length < MAX_PLAYERS_PER_ROOM) seats.push({ owner: id, name: peer.name });
    }
    state.players = seats.map((seat, index) => ({ pid: index, ...seat, colour: colourFor(index), score: 0 }));
    state.target = target(state.players.length);
    const opts = { arena: arena(state.players.length) };
    state.rng = seededRng(Date.now() % 2147483647);
    const sim = new Simulation(state.players.length, opts, state.rng);
    state.sim = sim;
    state.tickHz = tickHz;
    diagnostics.configure({ tickHz, budgetBytes: schema.budgetBytes * state.players.length });
    // A worker drives the loop so a hidden host tab keeps its tick rate.
    state.timers = config.loopDeps ?? workerTimers() ?? undefined;
    state.host = hostGame({
      loopDeps: state.timers,
      onFrame: ({ bytes, tick }) => diagnostics.snapshot(bytes, tick),
      onRtt: (ms) => diagnostics.rtt(ms),
      onCommand: onCommand ? (index, data) => onCommand(sim, index, data) : null,
      sim, schema, players: state.players, transport: star.transport,
      tickHz, target: state.target, opts,
      onLocal: (msg) => {
        if (msg.t === "lobby") { ui.enterGame(); renderBoard([]); stage.lobby(msg); return; }
        if (msg.t === "round") { state.over = false; diagnostics.round(); ui.showNext(false); ui.banner(`Round ${msg.n}`, 1400); stage.round(msg); return; }
        if (msg.t === "score") { renderBoard(msg.scores); return; }
        if (msg.t === "over") { state.over = true; ui.showNext(true, msg.winner < 0 ? "Next round" : "New match"); ui.banner(msg.winner < 0 ? "Round over" : `${state.players[msg.winner]?.name} wins`); stage.over(msg); return; }
        state.snapshot = msg;
        stage.snapshot(msg);
        diagnostics.tick();
        mixer.onSnapshot(msg, { rng: audioRng });
      },
    });
    state.host.start();
  }

  // After a match winner the same control starts a fresh match with the peers now connected.
  function advance() {
    if (!isHost() || !state.sim?.roundOver) return false;
    if (state.host.matchOver()) { state.host.stop(); hostStart(); } else state.host.nextRound();
    return true;
  }
  ui.onNext(advance);
  doc?.addEventListener("keydown", (event) => {
    if (event.code === "Space" && advance()) event.preventDefault();
  });

  const context = {
    players: () => state.players,
    colourFor,
    isHost,
    target: () => state.target,
    seat: () => state.players.findIndex((p) => p.owner === state.selfId),
    hud: (text) => ui.setHud(text),
    banner: (text, ms) => (text ? ui.banner(text, ms) : ui.clearBanner()),
    selfId: () => state.selfId,
    spectator: () => state.spectator,
    // Sets one intent field from a source the bindings cannot express, such as mouse look.
    intent: (field, value) => input.touch(field, value),
    // A discrete request to the host's onCommand; the answer reaches the view's reply hook.
    command: (data) => {
      if (state.spectator) return;
      if (!isHost()) { star?.transport.sendToHost(JSON.stringify({ t: "c", d: data })); return; }
      const reply = state.host?.command(context.seat(), data);
      if (reply !== undefined) stage.reply(reply);
    },
  };

  // A scoreboard hook lets a team game show rows that are not one per player.
  function renderBoard(scores) {
    state.players.forEach((p, i) => { p.score = scores[i] ?? p.score ?? 0; });
    ui.renderScores(scoreboard ? scoreboard(state.players, scores) : state.players);
  }

  const stage = createStage({
    mount, draw, arena: ui.arena, context,
    makeSurface: () => createSurface({ container: ui.arena, layers: config.layers || ["world", "actors"], palette: PLAYER_COLOURS }),
  });
  const surface = stage.surface;

  function frame() {
    const snapshot = isHost() ? state.snapshot : state.client?.sample();
    if (snapshot) {
      if (!isHost()) {
        diagnostics.buffer(state.client.stats());
        // Each buffered frame sounds once, when the screen first reaches its tick.
        const tick = snapshot[schema.tickField];
        for (const shown of state.client.presented(state.presented, tick)) mixer.onSnapshot(shown, { rng: audioRng });
        if (tick > state.presented) state.presented = tick;
      }
      stage.draw(snapshot);
    }
    const row = diagnostics.sample();
    if (row && row !== state.row) {
      state.row = row;
      const dropped = state.host?.stats().dropped ?? 0;
      diagnostics.dropped(dropped - state.loopDropped);
      state.loopDropped = dropped;
      (state.host ?? state.client)?.probe();
      ui.renderOverlay(diagnostics.overlayRows());
    }
    globalThis.requestAnimationFrame?.(frame);
  }
  globalThis.requestAnimationFrame?.(frame);

  // A read-only window for the soak harness and for debugging; nothing here mutates the game.
  globalThis.__engine = {
    version: ENGINE_VERSION,
    diagnostics: {
      enabled: diagnostics.isEnabled, current: diagnostics.current, samples: diagnostics.samples,
      series: diagnostics.series, worst: diagnostics.worst, breaches: diagnostics.breaches,
    },
    state: () => ({
      room: state.room, selfId: state.selfId, isHost: isHost(), spectator: state.spectator,
      players: state.players.length, tickHz: state.tickHz ?? null, over: state.over,
      round: state.sim?.round ?? null, peers: star?.states() ?? [],
      loop: state.host?.stats() ?? null, workerLoop: state.timers?.usesWorker?.() ?? false,
      audio: {
        unlocked: mixer.unlocked(), muted: mixer.muted(), voices: mixer.voices(), started: mixer.started(),
        context: audio?.state?.() ?? null, loaded: [...sounds.loaded], failures: { ...sounds.failures },
      },
    }),
  };

  return { ui, surface, view: stage.view, peers: () => star?.states() ?? [], signal, state, diagnostics, input, mixer, engineVersion: ENGINE_VERSION };
}

export const ENGINE = ENGINE_VERSION;
export { defineSnapshot as snapshot };
