// The signalling socket. It carries SDP and ICE and nothing about the game.
import { PROTOCOL_VERSION, SIGNAL_PING_INTERVAL_MS } from "./params.js";

export function connectSignal({ url, onMessage, onStatus = () => {}, deps = {} }) {
  const Socket = deps.WebSocket || globalThis.WebSocket;
  const schedule = deps.setInterval || setInterval;
  const cancel = deps.clearInterval || clearInterval;
  const socket = new Socket(url);
  let heartbeat = null;

  socket.onopen = () => {
    onStatus("connected");
    heartbeat = schedule(() => {
      if (socket.readyState === 1) socket.send(JSON.stringify({ t: "ping", v: PROTOCOL_VERSION }));
    }, SIGNAL_PING_INTERVAL_MS);
  };
  socket.onclose = () => { cancel(heartbeat); onStatus("signalling closed"); };
  socket.onerror = () => onStatus("signalling error");
  socket.onmessage = (event) => onMessage(JSON.parse(event.data));

  return {
    socket,
    send: (msg) => socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...msg })),
    close: () => { cancel(heartbeat); socket.close(); },
    ready: () => socket.readyState === 1,
  };
}
