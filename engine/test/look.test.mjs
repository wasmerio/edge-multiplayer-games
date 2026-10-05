// A game's own look: its player palette, its banner copy and its own touch buttons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { colourFor, paletteOf } from "../palette.js";
import { labelsWith, mountUi } from "../ui.js";
import { fakeDocument, walk } from "./fake-dom.mjs";

test("a game palette replaces the shared colours and wraps; without one the shared eight apply", () => {
  const own = paletteOf(["#111111", "#222222"]);
  assert.deepEqual([own(0), own(1), own(2)], ["#111111", "#222222", "#111111"]);
  for (const none of [undefined, null, [], "red"]) assert.equal(paletteOf(none)(3), colourFor(3));
});

test("banner and next-control copy default to the engine's and are overridden one by one", () => {
  const plain = labelsWith();
  assert.deepEqual([plain.round(2), plain.over("ann"), plain.over(null), plain.next(false), plain.next(true)],
    ["Round 2", "ann wins", "Round over", "Next round", "New match"]);
  const own = labelsWith({ round: (n) => `Shift ${n}`, next: (match) => (match ? "Again" : "Go") });
  assert.deepEqual([own.round(2), own.over("ann"), own.next(true)], ["Shift 2", "ann wins", "Again"]);
});

// A page of its own: elements carry data-engine roles and the kit only binds to them.
function ownedPage(roles, touch = []) {
  const doc = fakeDocument();
  const nodes = [];
  for (const role of roles) {
    const node = doc.createElement("div");
    node.setAttribute("data-engine", role);
    nodes.push(doc.body.appendChild(node));
  }
  for (const spec of touch) {
    const node = doc.createElement("button");
    node.setAttribute("data-engine-touch", spec);
    nodes.push(doc.body.appendChild(node));
  }
  const attr = (selector) => selector.match(/^\[([a-z-]+)(?:="([^"]*)")?\]$/);
  doc.querySelectorAll = (selector) => {
    const [, key, value] = attr(selector);
    const hits = [];
    walk(doc.body, (n) => { if (key in n.attributes && (value === undefined || n.attributes[key] === value)) hits.push(n); });
    return hits;
  };
  doc.querySelector = (selector) => doc.querySelectorAll(selector)[0] ?? null;
  return { doc, role: (name) => doc.querySelector(`[data-engine="${name}"]`) };
}

test("a page's own touch buttons count as touch controls and set the named intent field", () => {
  const { doc } = ownedPage(["arena"], ["act=-1", "act=1"]);
  const touched = [];
  const ui = mountUi({ container: doc.body, title: "t", doc, storage: null, where: { origin: "o", search: "" }, intent: { act: {} }, onTouch: (f, v) => touched.push([f, v]) });
  assert.equal(ui.owned, true);
  assert.equal(ui.hasTouch, true);
  const drill = doc.querySelectorAll("[data-engine-touch]")[1];
  drill.dispatch("pointerdown");
  drill.dispatch("pointerup");
  assert.deepEqual(touched, [["act", 1], ["act", 0]]);
  const bare = ownedPage(["arena"]);
  assert.equal(mountUi({ container: bare.doc.body, title: "t", doc: bare.doc, storage: null, where: { origin: "o", search: "" } }).hasTouch, false);
});

test("an owned scoreboard paints each row's swatch from the game palette", () => {
  const { doc, role } = ownedPage(["arena", "scores"]);
  const ui = mountUi({ container: doc.body, title: "t", doc, storage: null, where: { origin: "o", search: "" }, palette: ["#abcdef"] });
  ui.renderScores([{ name: "ann", score: 3 }, { name: "bob", score: 1, colour: "#000001" }]);
  const swatches = [];
  walk(role("scores"), (n) => { if (n.classList.contains("swatch")) swatches.push(n.attributes.style); });
  assert.deepEqual(swatches, ["background:#abcdef", "background:#000001"]);
});

test("the next control takes the game's label when it is shown", () => {
  const { doc, role } = ownedPage(["arena", "next"]);
  const ui = mountUi({ container: doc.body, title: "t", doc, storage: null, where: { origin: "o", search: "" } });
  ui.showNext(true, labelsWith({ next: () => "Next shift · Space" }).next(false));
  assert.equal(role("next").textContent, "Next shift · Space");
  assert.equal(role("next").hidden, false);
});
