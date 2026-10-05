// Phase 9: the UI kit over a bare container, without a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mountUi, OVERLAY_CHORD } from "../ui.js";
import { colourFor } from "../palette.js";
import { SUPERAPP_ORIGIN } from "../params.js";
import { fakeDocument, find, textOf } from "./fake-dom.mjs";

const memory = (seed = {}) => {
  const box = { ...seed };
  return { box, getItem: (k) => box[k] ?? null, setItem: (k, v) => { box[k] = String(v); } };
};
const denied = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
const button = (root, label) => find(root, (n) => n.tag === "button" && n.textContent === label);

function mount(options = {}) {
  const doc = fakeDocument();
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const replaced = [];
  const where = { origin: "https://game.example", search: "", replaceState: (a, b, url) => replaced.push(url), ...options.where };
  const calls = [];
  const ui = mountUi({
    container, title: "Test game", doc, storage: memory(), where,
    onCreate: (name) => calls.push(["create", name]),
    onJoin: (room, name) => calls.push(["join", room, name]),
    onStart: () => calls.push(["start"]),
    ...options, where,
  });
  return { doc, container, ui, calls, replaced };
}

test("the kit builds every element it reads into a bare container", () => {
  const { container, ui, doc } = mount({ touchControls: [{ field: "turn", value: 1, label: ">" }], intent: { turn: {} } });
  ui.setStatus("s"); ui.setHud("h"); ui.setMuteLabel(true); ui.onMute(() => {}); ui.onNext(() => {}); ui.showNext(true);
  ui.showRoom({ room: "ABCD", isHost: true, canStart: true });
  ui.renderPeers([{ id: "1", name: "ann", connected: true }]);
  ui.renderScores([{ name: "ann", score: 2 }]);
  ui.banner("Round 1"); ui.clearBanner(); ui.enableTouch(true); ui.setOverlay("x"); ui.enterGame();
  assert.ok(container.classList.contains("engine-root"));
  assert.ok(doc.head.children.some((n) => n.tag === "style"), "the kit ships its own stylesheet");
  assert.ok(ui.arena && ui.overlayNode && ui.hudNode);
  assert.match(textOf(container), /Test game/);
});

test("the kit links back to the superapp", () => {
  const { container } = mount();
  assert.ok(find(container, (n) => n.tag === "a" && n.attributes.href === SUPERAPP_ORIGIN));
});

test("the create and room parameters are read by the kit, not the game", () => {
  assert.deepEqual(mount({ where: { search: "?create=1" } }).ui.contract, { room: null, create: true });
  assert.deepEqual(mount({ where: { search: "?room=ABCD" } }).ui.contract, { room: "ABCD", create: false });
  assert.deepEqual(mount().ui.contract, { room: null, create: false });
});

test("a malformed room parameter is passed on for the server to refuse by name", () => {
  const { ui, container } = mount({ where: { search: "?room=%3Cscript%3E" } });
  assert.equal(ui.contract.room, "<script>");
  ui.setStatus("error: no_such_room");
  assert.match(textOf(container), /error: no_such_room/);
});

test("showing a room puts the code in the address bar and the full link in the invite panel", () => {
  const { ui, container, replaced } = mount();
  ui.showRoom({ room: "WXYZ", isHost: true, canStart: true });
  assert.deepEqual(replaced, ["?room=WXYZ"]);
  const link = find(container, (n) => n.tag === "a" && n.classList.contains("engine-invite"));
  assert.equal(link.href, "https://game.example/?room=WXYZ");
  assert.equal(link.textContent, "https://game.example/?room=WXYZ");
  assert.ok(!link.parentNode.parentNode.classList.contains("engine-hidden"), "the invite panel is visible to the host");
});

test("a missing container is refused naming the expected element", () => {
  assert.throws(() => mountUi({ container: null, title: "x", doc: fakeDocument() }), /container is required.*id "game"/);
});

test("a touch control for an unknown intent field is refused by name", () => {
  assert.throws(
    () => mount({ touchControls: [{ field: "jump", value: 1, label: "^" }], intent: { turn: {} } }),
    /unknown intent field jump/,
  );
});

test("a blocked store still yields a generated name and never throws", () => {
  const { ui, calls, container } = mount({ storage: denied });
  const name = ui.name();
  assert.match(name, /^player-/);
  button(container, "Create room").onclick();
  assert.deepEqual(calls, [["create", name]]);
});

test("the name is persisted and offered again", () => {
  const storage = memory();
  const first = mount({ storage });
  const name = first.ui.name();
  assert.equal(storage.box["engine-name"], name);
  assert.equal(mount({ storage }).ui.name(), name);
});

test("the copy control copies the invite link and confirms", async () => {
  const written = [];
  const { ui, container, replaced } = mount({ clipboard: { writeText: async (text) => { written.push(text); } } });
  ui.showRoom({ room: "ABCD", isHost: true, canStart: true });
  const copy = button(container, "copy");
  await copy.onclick();
  assert.deepEqual(written, ["https://game.example/?room=ABCD"]);
  assert.equal(copy.textContent, "copied");
  assert.equal(replaced.length, 1, "copying does not navigate");
});

test("an unavailable clipboard is reported and the link stays selectable", async () => {
  for (const clipboard of [{}, { writeText: async () => { throw new Error("denied"); } }]) {
    const { ui, container } = mount({ clipboard });
    ui.showRoom({ room: "ABCD", isHost: true, canStart: true });
    const copy = button(container, "copy");
    await copy.onclick();
    assert.equal(copy.textContent, "select the link");
    assert.equal(find(container, (n) => n.classList.contains("engine-invite")).textContent, "https://game.example/?room=ABCD");
  }
});

test("without a palette asset the scoreboard falls back to the shared colours", () => {
  const swatches = (palette) => {
    const { ui, container } = mount({ palette });
    ui.renderScores([{ name: "a" }, { name: "b" }]);
    const found = [];
    const visit = (n) => { if (n.classList.contains("engine-swatch")) found.push(n.attributes.style); n.children.forEach(visit); };
    visit(container);
    return found;
  };
  assert.deepEqual(swatches(undefined), [`background:${colourFor(0)}`, `background:${colourFor(1)}`]);
  assert.deepEqual(swatches([]), [`background:${colourFor(0)}`, `background:${colourFor(1)}`]);
  assert.deepEqual(swatches(["#123456"]), ["background:#123456", "background:#123456"]);
});

test("the peer list shows a peer's channel state and drops it when it changes", () => {
  const { ui, container } = mount();
  ui.renderPeers([{ id: "1", name: "ann", connected: true }, { id: "2", name: "bob", connected: true, channel: "connecting" }]);
  assert.match(textOf(container), /bob · connecting/);
  ui.renderPeers([{ id: "1", name: "ann", connected: true }, { id: "2", name: "bob", connected: true, channel: "open" }]);
  const text = textOf(container);
  assert.match(text, /bob · open/);
  assert.doesNotMatch(text, /bob · connecting/);
  assert.ok(find(container, (n) => n.attributes["data-channel"] === "open"));
});

test("the overlay is off by default, on by the query parameter, and toggled by the key chord", () => {
  const toggles = [];
  const off = mount({ onOverlay: (on) => toggles.push(on) });
  assert.equal(off.ui.overlayOn(), false);
  off.doc.dispatch("keydown", { code: OVERLAY_CHORD.code, altKey: true, shiftKey: false });
  assert.equal(off.ui.overlayOn(), false, "the chord needs both modifiers");
  off.doc.dispatch("keydown", { ...OVERLAY_CHORD });
  assert.equal(off.ui.overlayOn(), true);
  off.doc.dispatch("keydown", { ...OVERLAY_CHORD });
  assert.equal(off.ui.overlayOn(), false);
  assert.deepEqual(toggles, [true, false]);
  assert.equal(mount({ where: { search: "?overlay=1" } }).ui.overlayOn(), true);
});

test("the overlay renders one line per series with its value and sparkline", () => {
  const { ui } = mount();
  ui.renderOverlay([{ name: "tickHz", value: 30, spark: "▁▂" }, { name: "rtt", value: "–", spark: "·" }]);
  assert.deepEqual(ui.overlayNode.children.map((n) => n.attributes["data-series"]), ["tickHz", "rtt"]);
  assert.match(ui.overlayNode.children[0].textContent, /tickHz\s+30 ▁▂/);
});

test("both colour schemes are themed and every colour is a theme property", () => {
  const source = fs.readFileSync(new URL("../ui.js", import.meta.url), "utf8");
  const css = source.slice(source.indexOf("const CSS = `"), source.indexOf("`;", source.indexOf("const CSS = `")));
  assert.match(css, /prefers-color-scheme:light/);
  assert.match(css, /\[data-theme=light\]/);
  assert.match(css, /\.engine-root\{[^}]*background:var\(--bg\)/, "the container sets an explicit background");
  const outsideTokens = css.replace(/--[a-z-]+:#[0-9a-f]{3,8}/gi, "");
  assert.deepEqual(outsideTokens.match(/#[0-9a-f]{3,8}\b/gi) ?? [], [], "a literal colour sits outside the theme properties");
  for (const scheme of css.match(/\{--bg:[^}]*\}/g)) assert.match(scheme, /--field:/, "each scheme themes its form fields");
});

test("the stylesheet has no fixed pixel width that could force a phone to scroll sideways", () => {
  const source = fs.readFileSync(new URL("../ui.js", import.meta.url), "utf8");
  const css = source.slice(source.indexOf("const CSS = `"), source.indexOf("`;", source.indexOf("const CSS = `")));
  const fixed = (css.match(/[;{](?:min-)?width:(\d+)px/g) ?? []).map((rule) => Number(rule.match(/(\d+)px/)[1]));
  assert.ok(fixed.every((px) => px <= 72), `fixed widths ${fixed} stay within a touch target`);
  assert.match(css, /\.engine-arena\{[^}]*max-width:100%/);
});
