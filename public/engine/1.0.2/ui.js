// The shared chrome. A game's page is a container, a script tag and metadata;
// the kit builds the rest and performs the sub-app contract, so a game cannot
// forget it.
import { PLAYER_NAME_MAX_CHARS, STICK_DEAD_ZONE, SUPERAPP_ORIGIN } from "./params.js";
import { colourFor } from "./palette.js";

const CSS = `
.engine-root{--bg:#0e1013;--panel:#171a1f;--ink:#e8ecf1;--muted:#8b949e;--line:#262b33;--accent:#4ba8ff;
  --field:#0b0d10;--arena:#000;--on-arena:#e8ecf1;--shade:#000a;
  color:var(--ink);background:var(--bg);font:16px/1.5 system-ui,sans-serif;min-height:100vh;margin:0;
  display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;box-sizing:border-box}
@media (prefers-color-scheme:light){.engine-root:not([data-theme=dark]){--bg:#f6f7f9;--panel:#fff;--ink:#11151a;--muted:#5b6672;--line:#dfe3e8;--field:#fff}}
.engine-root[data-theme=light]{--bg:#f6f7f9;--panel:#fff;--ink:#11151a;--muted:#5b6672;--line:#dfe3e8;--field:#fff}
.engine-root *{box-sizing:border-box}
.engine-head{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;width:100%;max-width:960px}
.engine-head h1{font-size:1.15rem;margin:0;font-weight:650}
.engine-head a{color:var(--accent);text-decoration:none;font-size:.85rem}
.engine-spacer{flex:1}
.engine-panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;width:100%;max-width:960px}
.engine-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.engine-root input,.engine-root button,.engine-root select{font:inherit;color:var(--ink);background:var(--field);
  border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-height:44px;max-width:100%}
.engine-root button{cursor:pointer}
.engine-root button:disabled{opacity:.5;cursor:default}
.engine-muted{color:var(--muted);font-size:.85rem}
.engine-arena{position:relative;margin:0 auto;max-width:100%;background:var(--arena);border-radius:10px;overflow:hidden}
.engine-layer{position:absolute;inset:0;width:100%;height:100%;display:block}
.engine-banner,.engine-touch,.engine-overlay{z-index:1}
.engine-banner{position:absolute;inset:0;display:grid;place-items:center;font-size:clamp(1.2rem,5vw,2rem);
  font-weight:700;color:var(--on-arena);text-shadow:0 2px 12px var(--shade);pointer-events:none}
.engine-scores{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:10px}
.engine-scores li{display:flex;gap:6px;align-items:center}
.engine-scores li.dead{opacity:.45}
.engine-swatch{width:12px;height:12px;border-radius:3px;display:inline-block}
.engine-invite{word-break:break-all;color:var(--accent)}
.engine-touch{position:absolute;inset:auto 0 0 0;display:none;justify-content:space-between;padding:12px;gap:12px}
.engine-root[data-touch=on] .engine-touch{display:flex}
.engine-touch button{min-width:72px;min-height:72px;font-size:1.4rem;opacity:.75;touch-action:none}
.engine-overlay{position:absolute;top:8px;left:8px;font:12px ui-monospace,monospace;color:var(--on-arena);
  background:var(--shade);border-radius:6px;padding:6px 8px;display:none;white-space:pre;pointer-events:none;
  max-width:calc(100% - 16px);overflow:hidden}
.engine-root[data-overlay=on] .engine-overlay{display:block}
.engine-hidden{display:none!important}
`;

// What the kit still needs when the page brings its own chrome and stylesheet.
const FUNCTIONAL_CSS = `
.engine-hidden{display:none!important}
[data-engine=arena]{position:relative}
.engine-layer{position:absolute;inset:0;width:100%;height:100%;display:block}
.engine-overlay{position:absolute;top:8px;left:8px;z-index:2;font:12px ui-monospace,monospace;color:#fff;background:#000a;
  border-radius:6px;padding:6px 8px;display:none;white-space:pre}
[data-overlay=on] .engine-overlay{display:block}
[data-engine-touch],[data-engine-stick]{touch-action:none;-webkit-user-select:none;user-select:none}
`;

const el = (doc, tag, props = {}, children = []) => {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on")) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.appendChild(child);
  return node;
};

// Banner and next-control copy; a game overrides any of the three through `labels`.
export const labelsWith = (labels = {}) => ({
  round: (n) => `Round ${n}`,
  over: (winner) => (winner ? `${winner} wins` : "Round over"),
  next: (matchOver) => (matchOver ? "New match" : "Next round"),
  ...labels,
});

// Alt+Shift+D toggles the diagnostics overlay; `?overlay=1` starts with it on.
export const OVERLAY_CHORD = { code: "KeyD", altKey: true, shiftKey: true };

export function mountUi({
  container, title, doc = globalThis.document, where = globalThis.location,
  storage, touchControls = [], intent, palette, clipboard,
  onCreate, onJoin, onStart, onTouch, onOverlay,
}) {
  if (!container) throw new Error('mountUi: container is required; the page needs an element with id "game"');
  for (const control of touchControls) {
    if (intent && !intent[control.field]) throw new Error(`mountUi: touch control names unknown intent field ${control.field}`);
  }
  // Reading the global store can itself throw when storage is blocked.
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  const board = () => { try { return clipboard ?? globalThis.navigator?.clipboard ?? null; } catch { return null; } };
  const swatch = (index) => (Array.isArray(palette) && palette.length ? palette[index % palette.length] : null) || colourFor(index);
  const read = (key, fallback = "") => { try { return storage?.getItem(key) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { storage?.setItem(key, value); } catch { /* a blocked store is not fatal */ } };

  // A page that marks its own elements with data-engine="<role>" owns its look:
  // the kit binds behaviour to them and brings no layout or theme of its own.
  const slot = (role) => doc.querySelector?.(`[data-engine="${role}"]`) ?? null;
  const owned = Boolean(slot("arena"));
  // The kit's own elements carry the same role, so a tool finds a control either way.
  const make = (role, tag, props) => (owned && slot(role)) || el(doc, tag, { ...props, "data-engine": role });
  const show = (node, on) => { node.classList.toggle("engine-hidden", !on); if (owned) node.hidden = !on; };

  doc.head?.appendChild(el(doc, "style", { text: owned ? FUNCTIONAL_CSS : CSS }));
  if (!owned) {
    container.classList.add("engine-root");
    if (container.parentNode && container.parentNode === doc.body) doc.body.style.margin = "0";
  }

  const name = make("name", "input", { id: "engine-name", placeholder: "your name", maxlength: String(PLAYER_NAME_MAX_CHARS), value: read("engine-name") });
  if (!name.value) name.value = read("engine-name");
  name.onchange = () => write("engine-name", name.value.trim());
  const code = make("code", "input", { id: "engine-code", placeholder: "room code", maxlength: "8", size: "8" });
  const create = make("create", "button", { text: "Create room" });
  const join = make("join", "button", { text: "Join" });
  const start = make("start", "button", { text: "Start" });
  const copy = make("copy", "button", { text: "copy" });
  const copyLabel = copy.textContent;
  const mute = make("mute", "button", { text: "sound on" });
  const next = make("next", "button", { class: "engine-hidden", text: "Next round" });
  const hud = make("hud", "div", { class: "engine-hud engine-muted" });

  const status = make("status", "span", { class: "engine-muted", text: "connecting" });
  const roomCode = make("room-code", "strong", { text: "----" });
  const inviteLink = make("invite-link", "a", { class: "engine-invite", href: "#", text: "" });
  const peers = make("peers", "ul", { class: "engine-scores" });
  const scores = make("scores", "ul", { class: "engine-scores" });
  const banner = make("banner", "div", { class: "engine-banner engine-hidden" });
  const overlay = el(doc, "div", { class: "engine-overlay" });
  const arena = owned ? slot("arena") : el(doc, "div", { class: "engine-arena" }, [banner, overlay]);
  if (owned) { if (!slot("banner")) arena.appendChild(banner); arena.appendChild(overlay); }

  // One pointer holds one button; sliding onto another button moves the hold with it.
  const down = new Set();
  const pressed = new Map();
  const sync = (field) => {
    let value = 0;
    for (const hold of pressed.values()) if (hold.field === field) value = hold.value;
    onTouch?.(field, value);
  };
  const letGo = (id) => {
    const was = pressed.get(id);
    if (!was) return;
    pressed.delete(id);
    if (![...pressed.values()].some((hold) => hold.button === was.button)) was.button.removeAttribute?.("data-pressed");
    sync(was.field);
  };
  const bindTouch = (button, field, value) => {
    const hold = (event) => {
      letGo(event.pointerId);
      pressed.set(event.pointerId, { button, field, value });
      button.setAttribute("data-pressed", "");
      sync(field);
    };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      down.add(event.pointerId);
      // A touch is captured by the element it began on; released, it reaches the next button.
      try { button.releasePointerCapture?.(event.pointerId); } catch { /* nothing was captured */ }
      hold(event);
    });
    button.addEventListener("pointerenter", (event) => { if (down.has(event.pointerId)) hold(event); });
    button.addEventListener("pointerleave", (event) => letGo(event.pointerId));
    for (const type of ["pointerup", "pointercancel"]) {
      button.addEventListener(type, (event) => { event.preventDefault(); letGo(event.pointerId); down.delete(event.pointerId); });
    }
  };
  for (const type of ["pointerup", "pointercancel"]) {
    doc.addEventListener?.(type, (event) => { letGo(event.pointerId); down.delete(event.pointerId); });
  }

  // A page's own thumb stick: data-engine-stick="mx,my" drives two intent fields from one drag.
  const bindStick = (stick) => {
    const [fieldX, fieldY, ...rest] = stick.getAttribute("data-engine-stick").split(",").map((name) => name.trim());
    if (!fieldX || !fieldY || rest.length) throw new Error('mountUi: data-engine-stick needs two intent fields, as in "mx,my"');
    for (const field of [fieldX, fieldY]) {
      if (intent && !intent[field]) throw new Error(`mountUi: stick names unknown intent field ${field}`);
    }
    const mode = stick.getAttribute("data-stick-mode") || "8way";
    if (mode !== "8way" && mode !== "analog") throw new Error(`mountUi: data-stick-mode must be 8way or analog, not ${mode}`);
    const dead = Number(stick.getAttribute("data-stick-dead") ?? STICK_DEAD_ZONE);
    if (!(dead >= 0 && dead < 1)) throw new Error("mountUi: data-stick-dead must be at least 0 and below 1");
    // Full deflection reaches the field's own max, and its min the other way.
    const span = (field, amount) => (amount >= 0 ? amount * (intent?.[field]?.max ?? 1) : -amount * (intent?.[field]?.min ?? -1));
    const setVar = (name, value) => (stick.style.setProperty ? stick.style.setProperty(name, value) : (stick.style[name] = value));
    let active = null;
    let sent = [0, 0];
    const send = (x, y) => {
      if (x !== sent[0]) onTouch?.(fieldX, span(fieldX, x));
      if (y !== sent[1]) onTouch?.(fieldY, span(fieldY, y));
      sent = [x, y];
    };
    const aim = (event) => {
      const box = stick.getBoundingClientRect();
      const radius = Math.min(box.width, box.height) / 2 || 1;
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);
      const distance = Math.hypot(dx, dy);
      const amount = Math.min(1, distance / radius);
      const ux = distance ? dx / distance : 0;
      const uy = distance ? dy / distance : 0;
      setVar("--stick-x", (ux * amount).toFixed(3));
      setVar("--stick-y", (uy * amount).toFixed(3));
      if (amount < dead) { send(0, 0); return; }
      if (mode === "8way") {
        const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        send(Math.round(Math.cos(sector)), Math.round(Math.sin(sector)));
      } else {
        // Eighths keep an analog drag from sending a message on every pixel.
        const push = (amount - dead) / (1 - dead);
        send(Math.round(ux * push * 8) / 8, Math.round(uy * push * 8) / 8);
      }
    };
    const rest0 = (event) => {
      if (event.pointerId !== active) return;
      active = null;
      stick.removeAttribute?.("data-active");
      setVar("--stick-x", "0");
      setVar("--stick-y", "0");
      send(0, 0);
    };
    stick.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      active = event.pointerId;
      stick.setAttribute("data-active", "");
      try { stick.setPointerCapture?.(event.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
      aim(event);
    });
    stick.addEventListener("pointermove", (event) => { if (event.pointerId === active) aim(event); });
    stick.addEventListener("pointerup", rest0);
    stick.addEventListener("pointercancel", rest0);
  };

  const touch = el(doc, "div", { class: "engine-touch" });
  let touchButtons = touchControls.length;
  if (owned) {
    // A page's own button: data-engine-touch="turn=-1".
    for (const button of doc.querySelectorAll?.("[data-engine-touch]") ?? []) {
      const [field, value] = button.getAttribute("data-engine-touch").split("=");
      if (intent && !intent[field]) throw new Error(`mountUi: touch control names unknown intent field ${field}`);
      bindTouch(button, field, Number(value));
      touchButtons += 1;
    }
    for (const stick of doc.querySelectorAll?.("[data-engine-stick]") ?? []) {
      bindStick(stick);
      touchButtons += 1;
    }
  } else {
    for (const control of touchControls) {
      const button = el(doc, "button", { text: control.label, "aria-label": control.label });
      bindTouch(button, control.field, control.value);
      touch.appendChild(button);
    }
    arena.appendChild(touch);
  }

  const detached = () => el(doc, "div");
  const invite = owned ? slot("invite") || detached() : el(doc, "div", { class: "engine-panel engine-hidden" }, [
    el(doc, "div", { class: "engine-row" }, [el(doc, "span", { text: "Invite:" }), inviteLink, copy]),
  ]);
  const lobby = owned ? slot("lobby") || detached() : el(doc, "div", { class: "engine-panel" }, [
    el(doc, "div", { class: "engine-row" }, [name, create, code, join]),
    el(doc, "div", { class: "engine-row" }, [peers, el(doc, "span", { class: "engine-spacer" }), start]),
  ]);
  // In a page of its own, the "game" slot is the section revealed when play starts.
  const scoreboard = owned ? slot("game") || detached() : el(doc, "div", { class: "engine-panel engine-hidden" }, [
    el(doc, "div", { class: "engine-row" }, [scores, el(doc, "span", { class: "engine-spacer" }), next]),
    hud,
  ]);
  const roomInfo = (owned && slot("room-info")) || detached();
  const hostControls = (owned && slot("host-controls")) || detached();
  const wait = (owned && slot("wait")) || detached();

  if (!owned) container.append(
    el(doc, "div", { class: "engine-head" }, [
      el(doc, "h1", { text: title }),
      el(doc, "span", { class: "engine-spacer" }),
      el(doc, "span", { class: "engine-row" }, [el(doc, "span", { text: "room " }), roomCode]),
      status,
      mute,
      el(doc, "a", { href: SUPERAPP_ORIGIN, text: "all games" }),
    ]),
    lobby, invite, arena, scoreboard,
  );

  const myName = () => {
    let value = name.value.trim();
    if (!value) {
      value = read("engine-name") || `player-${Math.random().toString(36).slice(2, 5)}`;
      name.value = value;
      write("engine-name", value);
    }
    return value;
  };

  create.onclick = () => onCreate?.(myName());
  join.onclick = () => onJoin?.(code.value.trim().toUpperCase(), myName());
  start.onclick = () => onStart?.();
  copy.onclick = async () => {
    try {
      const target = board();
      if (!target?.writeText) throw new Error("clipboard unavailable");
      await target.writeText(inviteLink.href);
      copy.textContent = "copied";
    } catch {
      copy.textContent = "select the link";
      try { globalThis.getSelection?.()?.selectAllChildren?.(inviteLink); } catch { /* selection is a convenience */ }
    }
    setTimeout(() => { copy.textContent = copyLabel; }, 1500);
  };

  const params = new URLSearchParams(where?.search || "");
  const setOverlayOn = (on) => { container.dataset.overlay = on ? "on" : "off"; onOverlay?.(on); };
  if (params.get("overlay") === "1") container.dataset.overlay = "on";
  doc.addEventListener?.("keydown", (event) => {
    if (event.code !== OVERLAY_CHORD.code || !event.altKey || !event.shiftKey) return;
    event.preventDefault?.();
    setOverlayOn(container.dataset.overlay !== "on");
  });

  let bannerTimer = null;
  let scoresKey = null;
  return {
    arena, overlayNode: overlay, hudNode: hud, owned, hasTouch: touchButtons > 0,
    setHud(text) { if (hud.textContent !== text) hud.textContent = text; },
    showNext(on, label = "Next round") { if (!owned || on) next.textContent = label; show(next, on); },
    onNext(fn) { next.onclick = () => fn(); },
    contract: { room: params.get("room"), create: params.has("create") },
    name: myName,
    enableTouch(on) { container.dataset.touch = on ? "on" : "off"; },
    setStatus(text) { status.textContent = text; },
    setMuteLabel(muted) { mute.textContent = muted ? "sound off" : "sound on"; },
    onMute(fn) { mute.onclick = () => fn(); },
    showRoom({ room, isHost, canStart }) {
      roomCode.textContent = room;
      const link = `${where.origin}/?room=${room}`;
      inviteLink.href = link;
      inviteLink.textContent = link;
      show(roomInfo, true);
      show(invite, isHost);
      show(hostControls, isHost);
      show(wait, !isHost);
      show(start, canStart);
      create.disabled = true;
      join.disabled = true;
      code.value = room;
      where.replaceState?.(null, "", `?room=${room}`);
    },
    enterGame() { show(lobby, false); show(scoreboard, true); },
    renderPeers(list) {
      // A page of its own styles the host and channel state from the classes and the attribute.
      peers.replaceChildren(...list.map((peer) => el(doc, "li", {
        class: [peer.host ? "host" : "", peer.you ? "you" : ""].filter(Boolean).join(" "),
        "data-channel": peer.channel || "none",
        text: `${peer.name}${owned && peer.you ? " (you)" : ""}${peer.spectator ? " (watching)" : ""}${peer.connected ? "" : " (away)"}${!owned && peer.channel ? ` · ${peer.channel}` : ""}`,
      })));
    },
    // Rows are rebuilt only when what they show changes, so a call per frame is cheap.
    renderScores(players) {
      const key = JSON.stringify(players.map((p) => [p.name, p.score ?? 0, p.colour, p.alive, p.you, p.host, p.state, p.note]));
      if (key === scoresKey) return false;
      scoresKey = key;
      scores.replaceChildren(
        ...players.map((player, index) => (owned ? el(doc, "li", {
          class: [player.alive === false ? "dead" : "", player.you ? "you" : "", player.host ? "host" : ""].filter(Boolean).join(" "),
          ...(player.state ? { "data-state": String(player.state) } : {}),
        }, [
          el(doc, "span", { class: "swatch", style: `background:${player.colour || swatch(index)}` }),
          el(doc, "span", { class: "name", text: String(player.name) }),
          el(doc, "strong", { class: "score", text: String(player.score ?? 0) }),
          ...(player.note ? [el(doc, "span", { class: "note", text: String(player.note) })] : []),
        ]) : el(doc, "li", { class: player.alive === false ? "dead" : "" }, [
          el(doc, "span", { class: "engine-swatch", style: `background:${player.colour || swatch(index)}` }),
          el(doc, "span", { text: `${player.name}: ${player.score ?? 0}${player.note ? ` · ${player.note}` : ""}` }),
        ]))),
      );
      return true;
    },
    // A newer banner cancels the pending hide of an older timed one.
    banner(text, ms, kind = "note") {
      clearTimeout(bannerTimer);
      banner.textContent = text;
      banner.setAttribute("data-kind", kind);
      show(banner, true);
      bannerTimer = ms ? setTimeout(() => show(banner, false), ms) : null;
    },
    clearBanner() { clearTimeout(bannerTimer); bannerTimer = null; show(banner, false); },
    setOverlay(text) { overlay.textContent = text; },
    overlayOn: () => container.dataset.overlay === "on",
    // One line per series: its name, the current value and a sparkline of the window.
    renderOverlay(rows) {
      overlay.replaceChildren(...rows.map((row) => el(doc, "div", {
        "data-series": row.name, text: `${row.name.padEnd(12)} ${String(row.value).padStart(7)} ${row.spark}`,
      })));
    },
  };
}
