// The repository's only accumulator. A game never writes its own.
import { MAX_CATCHUP_TICKS, MAX_TICK_HZ } from "./params.js";

export function fixedTick(hz, onTick, deps = {}) {
  if (!Number.isFinite(hz) || hz <= 0) throw new Error("fixedTick: hz must be positive");
  if (hz > MAX_TICK_HZ) throw new Error(`fixedTick: hz above MAX_TICK_HZ (${MAX_TICK_HZ})`);
  if (typeof onTick !== "function") throw new Error("fixedTick: onTick must be a function");

  const now = deps.now || (() => performance.now());
  const schedule = deps.setInterval || setInterval;
  const cancel = deps.clearInterval || clearInterval;
  const step = 1000 / hz;

  let last = now();
  let acc = 0;
  let ticks = 0;
  let dropped = 0;

  const pump = () => {
    const t = now();
    acc += t - last;
    last = t;
    let budget = MAX_CATCHUP_TICKS;
    while (acc >= step && budget > 0) {
      acc -= step;
      budget -= 1;
      ticks += 1;
      onTick(ticks);
    }
    // A backgrounded tab returns with a huge accumulator; discard the arrears
    // rather than running an unbounded burst.
    if (acc >= step) {
      dropped += Math.floor(acc / step);
      acc = 0;
    }
  };

  const handle = schedule(pump, step / 2);
  return {
    stop: () => cancel(handle),
    pump,
    stats: () => ({ ticks, dropped }),
  };
}
