// One byte in front of every snapshot frame says whether the rest is a full
// encoding or a delta, so a guest never guesses.
export const FULL = 0;
export const DELTA = 1;

export function frame(kind, buffer) {
  const out = new Uint8Array(buffer.byteLength + 1);
  out[0] = kind;
  out.set(new Uint8Array(buffer), 1);
  return out.buffer;
}

export function unframe(data) {
  const bytes = new Uint8Array(data);
  if (bytes.length < 1) throw new Error("frames: empty frame");
  const kind = bytes[0];
  if (kind !== FULL && kind !== DELTA) throw new Error(`frames: unknown frame kind ${kind}`);
  return { kind, buffer: bytes.slice(1).buffer };
}
