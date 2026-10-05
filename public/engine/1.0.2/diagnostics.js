// What a peer-to-peer game looks like from inside. Collection is passive and
// costs nothing while the overlay is off.
import { DIAG_SAMPLE_INTERVAL_MS, DIAG_WINDOW_SAMPLES } from "./params.js";

// Every counter is either reset by round() or kept for the life of the page.
export const COUNTER_SCOPE = {
  ticks: "cumulative", dropped: "cumulative", bytesOut: "cumulative", bytesIn: "cumulative", overBudget: "cumulative",
  starved: "round", staleSnapshots: "round",
};
export const SERIES = ["tickHz", "rtt", "outPerSec", "inPerSec", "snapshotBytes", "bufferDepth", "starved", "staleSnapshots"];

const BLOCKS = "▁▂▃▄▅▆▇█";

// A missing value draws as a gap, never as the last known bar.
export function sparkline(values) {
  const known = values.filter((v) => Number.isFinite(v));
  const lo = Math.min(...known);
  const span = Math.max(...known) - lo;
  return values.map((v) => {
    if (!Number.isFinite(v)) return "·";
    return BLOCKS[span === 0 ? 0 : Math.round(((v - lo) / span) * (BLOCKS.length - 1))];
  }).join("");
}

export function createCollector({ now = () => Date.now(), window: windowSize = DIAG_WINDOW_SAMPLES, enabled = false } = {}) {
  const counters = Object.fromEntries(Object.keys(COUNTER_SCOPE).map((name) => [name, 0]));
  const latest = { rtt: null, snapshotBytes: 0, bufferDepth: 0, tickHz: 0, targetHz: 0, outPerSec: 0, inPerSec: 0 };
  const samples = [];
  const breaches = [];
  // The interpolation buffer counts for its whole life; these offsets make its counters per round.
  const raw = { starved: 0, staleSnapshots: 0 };
  const base = { starved: 0, staleSnapshots: 0 };
  let worst = { bytes: 0, tick: null };
  let budget = 0;
  let on = enabled;
  let lastSample = now();
  let atSample = { ticks: 0, bytesOut: 0, bytesIn: 0 };
  let rttFresh = false;

  const add = (field, value = 1) => { if (on) counters[field] += value; };

  return {
    enable(value = true) { on = Boolean(value); if (on) lastSample = now(); },
    isEnabled: () => on,
    configure({ tickHz, budgetBytes } = {}) {
      if (tickHz !== undefined) latest.targetHz = tickHz;
      if (budgetBytes !== undefined) budget = budgetBytes;
    },
    tick() { add("ticks"); },
    dropped(count) { add("dropped", count); },
    sent(bytes) { add("bytesOut", bytes); if (on) latest.snapshotBytes = bytes; },
    received(bytes) { add("bytesIn", bytes); },
    transfer(out = 0, received = 0) { add("bytesOut", out); add("bytesIn", received); },
    snapshot(bytes, tick = null) {
      if (!on) return;
      latest.snapshotBytes = bytes;
      if (bytes > worst.bytes) worst = { bytes, tick };
      if (budget > 0 && bytes > budget) {
        counters.overBudget += 1;
        if (breaches.length < windowSize) breaches.push({ tick, bytes, budget });
      }
    },
    rtt(ms) { if (on) { latest.rtt = Math.round(ms); rttFresh = true; } },
    buffer(stats) {
      if (!on || !stats) return;
      latest.bufferDepth = stats.depth ?? 0;
      raw.starved = stats.starved ?? raw.starved;
      raw.staleSnapshots = (stats.stale ?? 0) + (stats.duplicate ?? 0);
      for (const name of Object.keys(raw)) {
        if (raw[name] < base[name]) base[name] = 0;
        counters[name] = raw[name] - base[name];
      }
    },
    round() {
      for (const name of Object.keys(raw)) { base[name] = raw[name]; counters[name] = 0; }
    },
    sample(interval = DIAG_SAMPLE_INTERVAL_MS) {
      if (!on) return null;
      const at = now();
      if (at - lastSample < interval) return samples.at(-1) ?? null;
      const elapsed = (at - lastSample) / 1000;
      const rate = (field) => Math.round((counters[field] - atSample[field]) / elapsed);
      latest.tickHz = rate("ticks");
      latest.outPerSec = rate("bytesOut");
      latest.inPerSec = rate("bytesIn");
      // An unanswered probe is a gap in the series, not the previous value again.
      if (!rttFresh) latest.rtt = null;
      rttFresh = false;
      atSample = { ticks: counters.ticks, bytesOut: counters.bytesOut, bytesIn: counters.bytesIn };
      lastSample = at;
      const row = { at, ...latest, ...counters };
      samples.push(row);
      if (samples.length > windowSize) samples.splice(0, samples.length - windowSize);
      return row;
    },
    last: () => samples.at(-1) ?? null,
    samples: () => samples.map((row) => ({ ...row })),
    series: (field) => samples.map((row) => row[field]),
    current: () => ({ ...latest, ...counters }),
    worst: () => ({ ...worst }),
    breaches: () => breaches.map((row) => ({ ...row })),
    overlayRows() {
      const row = samples.at(-1) ?? { ...latest, ...counters };
      return SERIES.map((name) => ({
        name,
        value: row[name] === null || row[name] === undefined ? "–" : Math.round(row[name]),
        spark: sparkline(samples.map((sample) => sample[name])),
      }));
    },
    reset() {
      for (const key of Object.keys(counters)) counters[key] = 0;
      for (const name of Object.keys(raw)) base[name] = raw[name];
      samples.length = 0;
      breaches.length = 0;
      worst = { bytes: 0, tick: null };
      atSample = { ticks: 0, bytesOut: 0, bytesIn: 0 };
    },
  };
}

// Counts every byte a transport carries; a missing transport stays missing.
export function meterTransport(transport, collector) {
  if (!transport) return null;
  const size = (data) => (typeof data === "string" ? data.length : data?.byteLength ?? 0);
  return {
    ...transport,
    broadcast(data) { collector.transfer(size(data) * transport.peers().length, 0); transport.broadcast(data); },
    // A send to a peer with no open channel carries nothing.
    sendTo(id, data) { if (transport.peers().includes(id)) collector.transfer(size(data), 0); transport.sendTo(id, data); },
    sendToHost(data) { if (transport.peers().length) collector.transfer(size(data), 0); transport.sendToHost(data); },
    onMessage(handler) { transport.onMessage((peer, data) => { collector.transfer(0, size(data)); handler(peer, data); }); },
  };
}
