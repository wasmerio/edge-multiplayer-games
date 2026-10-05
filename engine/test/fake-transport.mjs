// A loopback star: one host, many guests, no network and no browser.
export function createLoopback() {
  const guests = new Map();
  let hostHandler = () => {};
  const hostTransport = {
    broadcast: (data) => { for (const guest of guests.values()) guest.deliver(data); },
    sendTo: (id, data) => guests.get(id)?.deliver(data),
    sendToHost: () => { throw new Error("host cannot send to itself"); },
    onMessage: (handler) => { hostHandler = handler; },
    peers: () => [...guests.keys()],
  };
  const addGuest = (id) => {
    let handler = () => {};
    const guest = {
      id,
      deliver: (data) => handler(null, data),
      transport: {
        broadcast: (data) => hostHandler(id, data),
        sendTo: () => { throw new Error("guest cannot address a peer"); },
        sendToHost: (data) => hostHandler(id, data),
        onMessage: (h) => { handler = h; },
        peers: () => ["host"],
      },
    };
    guests.set(id, guest);
    return guest;
  };
  return { hostTransport, addGuest, guests };
}
