// A guest holds no game state. It decodes frames into whole snapshots, keeps
// them in the interpolation buffer, and renders what the buffer offers.
import { createBuffer } from "./interp.js";
import { DELTA, FULL, unframe } from "./frames.js";
import { PROTOCOL_VERSION } from "./params.js";

export function joinGame({ schema, transport, onLobby = () => {}, onRound = () => {}, onControl = () => {}, onError = () => {}, onSnapshot = () => {}, onFrame = () => {}, onRtt = () => {}, now = () => performance.now() }) {
  if (!schema || !transport) throw new Error("joinGame: schema and transport are required");
  let buffer = null;
  let previous = null;
  let players = 0;
  let awaitingFull = true;

  const handle = (_peerId, data) => {
    if (typeof data === "string") return control(JSON.parse(data));
    return snapshot(data);
  };

  function control(msg) {
    switch (msg.t) {
      case "lobby": {
        if (msg.v !== PROTOCOL_VERSION) {
          return onError({ code: "protocol_mismatch", expected: PROTOCOL_VERSION, got: msg.v });
        }
        if (msg.schema !== schema.hash) {
          return onError({ code: "schema_mismatch", expected: schema.hash, got: msg.schema });
        }
        players = msg.players.length;
        buffer = createBuffer({ schema, tickHz: msg.tickHz, now });
        previous = null;
        awaitingFull = true;
        return onLobby(msg);
      }
      case "round":
        buffer?.clear();
        previous = null;
        awaitingFull = true;
        return onRound(msg);
      case "over":
        buffer?.settle();
        return onControl(msg);
      case "ping":
        transport.sendToHost(JSON.stringify({ t: "pong", at: msg.at }));
        return undefined;
      case "pong":
        return onRtt(now() - msg.at);
      default:
        return onControl(msg);
    }
  }

  function snapshot(data) {
    if (!buffer) return onError({ code: "snapshot_before_lobby" });
    const { kind, buffer: payload } = unframe(data);
    if (kind === DELTA && (awaitingFull || !previous)) {
      transport.sendToHost(JSON.stringify({ t: "need-full" }));
      return undefined;
    }
    const decoded = kind === FULL ? schema.decode(payload, players) : schema.apply(previous, payload, players);
    previous = decoded;
    awaitingFull = false;
    buffer.push(decoded);
    onFrame({ bytes: payload.byteLength, full: kind === FULL, tick: decoded[schema.tickField] });
    onSnapshot(decoded);
    return undefined;
  }

  return {
    attach() { transport.onMessage(handle); return this; },
    sample: () => buffer?.sample() ?? null,
    probe() { transport.sendToHost(JSON.stringify({ t: "ping", at: now() })); },
    // Frames whose tick lies in (after, upTo], oldest first: what the screen has newly reached.
    presented: (after, upTo) => buffer?.between(after, upTo) ?? [],
    buffer: () => buffer,
    stats: () => buffer?.stats() ?? null,
  };
}
