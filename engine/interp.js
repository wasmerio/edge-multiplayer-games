// A guest renders a presentation tick a fixed number of ticks behind the
// newest arrival, so jitter in the stream never reaches the screen. The host
// renders its own state and never comes through here.
import { INTERP_BUFFER_TICKS } from "./params.js";

// With `tickHz` and `now` the presentation tick advances between arrivals, so
// motion is blended every frame rather than stepped once per tick.
export function createBuffer({ schema, depth = INTERP_BUFFER_TICKS, tickHz = 0, now = null }) {
  if (!schema) throw new Error("createBuffer: schema is required");
  const field = schema.tickField;
  const smooth = schema.interpolatedFields();
  let frames = [];
  // Set when the stream has ended, so the last frame is not withheld forever.
  let settled = false;
  let newestAt = 0;
  const stats = { pushed: 0, stale: 0, duplicate: 0, starved: 0, dropped: 0 };

  const push = (snapshot) => {
    const tick = snapshot[field];
    if (!Number.isFinite(tick)) throw new Error(`interp: snapshot has no numeric ${field}`);
    const newest = frames.length ? frames[frames.length - 1][field] : -Infinity;
    if (tick === newest || frames.some((f) => f[field] === tick)) { stats.duplicate += 1; return false; }
    if (tick < newest) { stats.stale += 1; return false; }
    frames.push(snapshot);
    if (now) newestAt = now();
    settled = false;
    stats.pushed += 1;
    // Keep one frame more than the depth so a bracket always exists.
    const keep = depth + 2;
    if (frames.length > keep) { stats.dropped += frames.length - keep; frames = frames.slice(-keep); }
    return true;
  };

  const presentationTick = () => {
    if (!frames.length) return null;
    const base = frames[frames.length - 1][field] - depth;
    if (!now || !tickHz) return base;
    // Never more than one tick past the last arrival: no extrapolation.
    return base + Math.min(1, Math.max(0, (now() - newestAt) * tickHz / 1000));
  };

  const sample = () => {
    if (frames.length === 0) return null;
    if (settled) return frames[frames.length - 1];
    if (frames.length === 1) { stats.starved += 1; return frames[0]; }
    const target = presentationTick();
    let older = frames[0];
    let newer = frames[1];
    for (let i = 0; i < frames.length - 1; i++) {
      if (frames[i][field] <= target && frames[i + 1][field] >= target) { older = frames[i]; newer = frames[i + 1]; break; }
    }
    // An exact hit is a healthy frame; only a target outside the buffer starves.
    if (target === older[field]) return older;
    if (target === newer[field]) return newer;
    if (target < older[field]) { stats.starved += 1; return older; }
    if (target > newer[field]) { stats.starved += 1; return newer; }
    const span = newer[field] - older[field];
    const alpha = span === 0 ? 0 : (target - older[field]) / span;
    const out = { ...older };
    for (const name of smooth) {
      const a = older[name];
      const b = newer[name];
      if (Array.isArray(a) && Array.isArray(b)) {
        out[name] = a.map((value, i) => blend(name, value, b[i], alpha));
      } else {
        out[name] = blend(name, a, b, alpha);
      }
    }
    return out;
  };

  const blend = (name, a, b, alpha) => {
    if (typeof a !== "number" || typeof b !== "number") {
      throw new Error(`interp: field ${name} is marked interpolated but holds a non-number`);
    }
    const wrap = schema.wrapOf?.(name);
    if (!wrap) return a + (b - a) * alpha;
    const turn = ((((b - a) % wrap) + wrap + wrap / 2) % wrap) - wrap / 2;
    return (((a + turn * alpha) % wrap) + wrap) % wrap;
  };

  return {
    push, sample, presentationTick,
    clear: () => { frames = []; settled = false; },
    settle: () => { settled = true; },
    between: (after, upTo) => frames.filter((f) => f[field] > after && f[field] <= upTo),
    depth: () => frames.length,
    stats: () => ({ ...stats, depth: frames.length }),
  };
}
