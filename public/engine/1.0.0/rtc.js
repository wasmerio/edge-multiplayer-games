// Star topology: the host holds one ordered reliable channel per guest.
// Edge offers no UDP relay, so only public STUN is configured.
export const ICE = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

export function createStar({ signal, isHost, hostId, selfId, onPeerState = () => {}, deps = {} }) {
  const Connection = deps.RTCPeerConnection || globalThis.RTCPeerConnection;
  const peers = new Map();
  let handler = () => {};

  function peerFor(id) {
    let peer = peers.get(id);
    if (!peer) { peer = { id, pc: null, dc: null }; peers.set(id, peer); }
    return peer;
  }

  function wire(peer, channel) {
    peer.dc = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => onPeerState(peer.id, "open");
    channel.onclose = () => onPeerState(peer.id, "closed");
    channel.onmessage = (event) => handler(peer.id, event.data);
  }

  function connect(id, initiator) {
    const peer = peerFor(id);
    if (peer.pc) return peer;
    const pc = new Connection(ICE);
    peer.pc = pc;
    pc.onicecandidate = (event) => {
      if (event.candidate) signal.send({ t: "signal", to: id, data: { candidate: event.candidate } });
    };
    pc.onconnectionstatechange = () => onPeerState(id, pc.connectionState);
    pc.ondatachannel = (event) => wire(peer, event.channel);
    if (initiator) {
      wire(peer, pc.createDataChannel("game", { ordered: true }));
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => signal.send({ t: "signal", to: id, data: { sdp: pc.localDescription } }));
    }
    return peer;
  }

  async function accept(from, data) {
    const peer = peers.get(from)?.pc ? peers.get(from) : connect(from, false);
    const pc = peer.pc;
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === "offer") {
        await pc.setLocalDescription(await pc.createAnswer());
        signal.send({ t: "signal", to: from, data: { sdp: pc.localDescription } });
      }
    } else if (data.candidate) {
      try { await pc.addIceCandidate(data.candidate); } catch { /* a late candidate is normal */ }
    }
  }

  const live = () => [...peers.values()].filter((p) => p.dc && p.dc.readyState === "open");
  const sendOn = (peer, data) => { if (peer?.dc?.readyState === "open") peer.dc.send(data); };

  return {
    connect, accept, peers,
    drop(id) {
      const peer = peers.get(id);
      peer?.dc?.close?.();
      peer?.pc?.close?.();
      peers.delete(id);
    },
    transport: {
      broadcast: (data) => { for (const peer of live()) sendOn(peer, data); },
      sendTo: (id, data) => sendOn(peers.get(id), data),
      sendToHost: (data) => sendOn(peers.get(hostId), data),
      onMessage: (fn) => { handler = fn; },
      peers: () => live().map((p) => p.id),
    },
    states: () => [...peers.values()].map((p) => ({
      id: p.id,
      connection: p.pc?.connectionState ?? "-",
      channel: p.dc?.readyState ?? "-",
    })),
    isHost, selfId,
  };
}
