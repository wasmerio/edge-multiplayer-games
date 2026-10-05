// A hidden tab's timers fire about once a second, which would slow the host's
// simulation for every guest. A worker's timers are not throttled, so the host
// loop is driven from one; without workers the page's own timers are used.
const SOURCE = "const t=new Map();onmessage=(e)=>{const[on,id,ms]=e.data;"
  + "if(on)t.set(id,setInterval(()=>postMessage(id),ms));else{clearInterval(t.get(id));t.delete(id);}};";

export function workerTimers(deps = {}) {
  const WorkerImpl = deps.Worker ?? globalThis.Worker;
  const BlobImpl = deps.Blob ?? globalThis.Blob;
  const urls = deps.URL ?? globalThis.URL;
  const native = { set: deps.setInterval ?? setInterval, clear: deps.clearInterval ?? clearInterval };
  if (!WorkerImpl || !BlobImpl || !urls?.createObjectURL) return null;

  let worker;
  try {
    worker = new WorkerImpl(urls.createObjectURL(new BlobImpl([SOURCE], { type: "text/javascript" })));
  } catch {
    return null;
  }
  const live = new Map();
  let failed = false;
  let next = 1;

  worker.onmessage = (event) => live.get(event.data)?.fn();
  // A worker refused after construction (a content policy) hands its timers to the page.
  worker.onerror = () => {
    failed = true;
    for (const entry of live.values()) entry.handle = native.set(entry.fn, entry.ms);
  };

  return {
    setInterval(fn, ms) {
      const id = next++;
      const entry = { fn, ms, handle: null };
      live.set(id, entry);
      if (failed) entry.handle = native.set(fn, ms); else worker.postMessage([1, id, ms]);
      return id;
    },
    clearInterval(id) {
      const entry = live.get(id);
      if (!entry) return;
      live.delete(id);
      if (entry.handle !== null) native.clear(entry.handle); else worker.postMessage([0, id]);
    },
    usesWorker: () => !failed,
  };
}
