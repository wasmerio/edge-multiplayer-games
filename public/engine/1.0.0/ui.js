// The shared chrome. A game's page is a container, a script tag and metadata;
// the kit builds the rest and performs the sub-app contract, so a game cannot
// forget it.
import { PLAYER_NAME_MAX_CHARS, SUPERAPP_ORIGIN } from "./params.js";
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
.engine-touch button{min-width:72px;min-height:72px;font-size:1.4rem;opacity:.75}
.engine-overlay{position:absolute;top:8px;left:8px;font:12px ui-monospace,monospace;color:var(--on-arena);
  background:var(--shade);border-radius:6px;padding:6px 8px;display:none;white-space:pre;pointer-events:none;
  max-width:calc(100% - 16px);overflow:hidden}
.engine-root[data-overlay=on] .engine-overlay{display:block}
.engine-hidden{display:none!important}
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

  doc.head?.appendChild(el(doc, "style", { text: CSS }));
  container.classList.add("engine-root");
  if (container.parentNode && container.parentNode === doc.body) doc.body.style.margin = "0";

  const name = el(doc, "input", { id: "engine-name", placeholder: "your name", maxlength: String(PLAYER_NAME_MAX_CHARS), value: read("engine-name") });
  name.onchange = () => write("engine-name", name.value.trim());
  const code = el(doc, "input", { id: "engine-code", placeholder: "room code", maxlength: "8", size: "8" });
  const create = el(doc, "button", { text: "Create room" });
  const join = el(doc, "button", { text: "Join" });
  const start = el(doc, "button", { text: "Start" });
  const copy = el(doc, "button", { text: "copy" });
  const mute = el(doc, "button", { text: "sound on" });
  const next = el(doc, "button", { class: "engine-hidden", text: "Next round" });
  const hud = el(doc, "div", { class: "engine-hud engine-muted" });

  const status = el(doc, "span", { class: "engine-muted", text: "connecting" });
  const roomCode = el(doc, "strong", { text: "----" });
  const inviteLink = el(doc, "a", { class: "engine-invite", href: "#", text: "" });
  const peers = el(doc, "ul", { class: "engine-scores" });
  const scores = el(doc, "ul", { class: "engine-scores" });
  const banner = el(doc, "div", { class: "engine-banner engine-hidden" });
  const overlay = el(doc, "div", { class: "engine-overlay" });
  const arena = el(doc, "div", { class: "engine-arena" }, [banner, overlay]);

  const touch = el(doc, "div", { class: "engine-touch" });
  for (const control of touchControls) {
    const button = el(doc, "button", { text: control.label, "aria-label": control.label });
    const press = (value) => (event) => { event.preventDefault(); onTouch?.(control.field, value); };
    button.addEventListener("pointerdown", press(control.value));
    button.addEventListener("pointerup", press(0));
    button.addEventListener("pointercancel", press(0));
    button.addEventListener("pointerleave", press(0));
    touch.appendChild(button);
  }
  arena.appendChild(touch);

  const invite = el(doc, "div", { class: "engine-panel engine-hidden" }, [
    el(doc, "div", { class: "engine-row" }, [el(doc, "span", { text: "Invite:" }), inviteLink, copy]),
  ]);
  const lobby = el(doc, "div", { class: "engine-panel" }, [
    el(doc, "div", { class: "engine-row" }, [name, create, code, join]),
    el(doc, "div", { class: "engine-row" }, [peers, el(doc, "span", { class: "engine-spacer" }), start]),
  ]);
  const scoreboard = el(doc, "div", { class: "engine-panel engine-hidden" }, [
    el(doc, "div", { class: "engine-row" }, [scores, el(doc, "span", { class: "engine-spacer" }), next]),
    hud,
  ]);

  container.append(
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
    setTimeout(() => { copy.textContent = "copy"; }, 1500);
  };

  const params = new URLSearchParams(where?.search || "");
  const setOverlayOn = (on) => { container.dataset.overlay = on ? "on" : "off"; onOverlay?.(on); };
  if (params.get("overlay") === "1") container.dataset.overlay = "on";
  doc.addEventListener?.("keydown", (event) => {
    if (event.code !== OVERLAY_CHORD.code || !event.altKey || !event.shiftKey) return;
    event.preventDefault?.();
    setOverlayOn(container.dataset.overlay !== "on");
  });

  return {
    arena, overlayNode: overlay, hudNode: hud,
    setHud(text) { if (hud.textContent !== text) hud.textContent = text; },
    showNext(on, label = "Next round") { next.textContent = label; next.classList.toggle("engine-hidden", !on); },
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
      invite.classList.toggle("engine-hidden", !isHost);
      start.classList.toggle("engine-hidden", !canStart);
      create.disabled = true;
      join.disabled = true;
      code.value = room;
      where.replaceState?.(null, "", `?room=${room}`);
    },
    enterGame() { lobby.classList.add("engine-hidden"); scoreboard.classList.remove("engine-hidden"); },
    renderPeers(list) {
      peers.replaceChildren(...list.map((peer) => el(doc, "li", {
        "data-channel": peer.channel || "none",
        text: `${peer.name}${peer.spectator ? " (watching)" : ""}${peer.connected ? "" : " (away)"}${peer.channel ? ` · ${peer.channel}` : ""}`,
      })));
    },
    renderScores(players) {
      scores.replaceChildren(
        ...players.map((player, index) => el(doc, "li", { class: player.alive === false ? "dead" : "" }, [
          el(doc, "span", { class: "engine-swatch", style: `background:${player.colour || swatch(index)}` }),
          el(doc, "span", { text: `${player.name}: ${player.score ?? 0}` }),
        ])),
      );
    },
    banner(text, ms) {
      banner.textContent = text;
      banner.classList.remove("engine-hidden");
      if (ms) setTimeout(() => banner.classList.add("engine-hidden"), ms);
    },
    clearBanner() { banner.classList.add("engine-hidden"); },
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
