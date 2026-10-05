// The host owns the simulation and is the only writer of game state. Every
// tick it broadcasts a frame; a round boundary always broadcasts a full one so
// a guest can render from scratch.
import { fixedTick } from "./loop.js";
import { DELTA, FULL, frame } from "./frames.js";
import { DEFAULT_TICK_HZ, PROTOCOL_VERSION } from "./params.js";

export function hostGame({
  sim, schema, players, transport, tickHz = DEFAULT_TICK_HZ,
  target = 0, opts = {}, onLocal = () => {}, onCommand = null, loopDeps,
  onFrame = () => {}, onRtt = () => {}, now = () => performance.now(),
}) {
  if (!sim || !schema || !transport) throw new Error("hostGame: sim, schema and transport are required");
  if (!Array.isArray(players) || players.length === 0) throw new Error("hostGame: players must be a non-empty array");

  const count = players.length;
  const inputs = players.map(() => 0);
  const local = new Map();
  let previous = null;
  let loop = null;
  let stopped = false;
  let sentScores = sim.scores.join(",");

  const lobby = {
    t: "lobby", v: PROTOCOL_VERSION, schema: schema.hash,
    players, target, tickHz, opts,
  };

  const control = (msg) => { transport.broadcast(JSON.stringify(msg)); onLocal(msg); };

  const broadcastSnapshot = (snapshot, forceFull) => {
    const result = forceFull || !previous
      ? { full: true, buffer: schema.encode(snapshot, count) }
      : schema.delta(previous, snapshot, count);
    previous = schema.decode(result.full ? result.buffer : schema.encode(snapshot, count), count);
    transport.broadcast(frame(result.full ? FULL : DELTA, result.buffer));
    onFrame({ bytes: result.buffer.byteLength, full: result.full, tick: snapshot[schema.tickField] });
    return result;
  };

  function startRound() {
    sim.startRound();
    previous = null;
    control({ t: "round", n: sim.round });
    const first = sim.step(Object.freeze([...inputs.map(() => 0)]));
    broadcastSnapshot(first, true);
    onLocal(first);
  }

  function tick() {
    if (sim.roundOver) return;
    for (const [index, value] of local) inputs[index] = value;
    const snapshot = sim.step(Object.freeze([...inputs]));
    broadcastSnapshot(snapshot, false);
    onLocal(snapshot);
    const scores = sim.scores.join(",");
    if (scores !== sentScores) { sentScores = scores; control({ t: "score", scores: [...sim.scores] }); }
    if (sim.roundOver) {
      const winner = sim.winner(target);
      control({ t: "over", winner, scores: [...sim.scores] });
    }
  }

  const sendFull = (peerId) => {
    if (previous) transport.sendTo(peerId, frame(FULL, schema.encode(previous, count)));
  };

  // A peer whose channel opens mid-game gets everything needed to render from scratch.
  function welcome(peerId) {
    if (!loop || stopped) return;
    const to = (msg) => transport.sendTo(peerId, JSON.stringify(msg));
    to(lobby);
    to({ t: "round", n: sim.round });
    sendFull(peerId);
    to({ t: "score", scores: [...sim.scores] });
    if (sim.roundOver) to({ t: "over", winner: sim.winner(target), scores: [...sim.scores] });
  }

  function onMessage(peerId, data) {
    if (typeof data !== "string") return;
    const msg = JSON.parse(data);
    if (msg.t === "ping") { transport.sendTo(peerId, JSON.stringify({ t: "pong", at: msg.at })); return; }
    if (msg.t === "pong") { onRtt(now() - msg.at, peerId); return; }
    if (msg.t === "need-full") { sendFull(peerId); return; }
    if (msg.t !== "i" && msg.t !== "c") return;
    const index = players.findIndex((p) => p.owner === peerId);
    if (index < 0) return;
    if (msg.t === "i") { inputs[index] = msg.d; return; }
    // A command is a discrete request outside the intent; only its sender hears the answer.
    const reply = onCommand?.(index, msg.d);
    if (reply !== undefined) transport.sendTo(peerId, JSON.stringify({ t: "c", d: reply }));
  }

  return {
    lobby,
    start() {
      if (stopped) throw new Error("hostGame: already stopped");
      transport.onMessage(onMessage);
      control(lobby);
      startRound();
      loop = fixedTick(tickHz, tick, loopDeps);
      return loop;
    },
    nextRound() {
      const winner = sim.winner(target);
      if (winner >= 0) { control({ t: "over", winner, scores: [...sim.scores] }); return false; }
      startRound();
      return true;
    },
    welcome,
    matchOver: () => sim.roundOver && sim.winner(target) >= 0,
    setLocalInput(index, value) { local.set(index, value); },
    // A round-trip probe; each guest answers and onRtt hears the elapsed time.
    probe() { transport.broadcast(JSON.stringify({ t: "ping", at: now() })); },
    command: (index, data) => onCommand?.(index, data),
    disconnect(peerId) {
      const index = players.findIndex((p) => p.owner === peerId);
      if (index < 0) return;
      inputs[index] = 0;
      sim.disconnect?.(index);
    },
    stop() { stopped = true; loop?.stop(); },
    stats: () => ({ ticks: loop?.stats().ticks ?? 0, dropped: loop?.stats().dropped ?? 0 }),
  };
}
