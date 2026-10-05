// The kit over a page that owns its markup and stylesheet (D-23), without a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountUi } from "../ui.js";
import { fakeDocument, find, walk } from "./fake-dom.mjs";

const ROLES = {
  status: "span", mute: "button", lobby: "section", name: "input", create: "button", code: "input", join: "button",
  "room-info": "div", "room-code": "strong", invite: "div", "invite-link": "a", copy: "button", peers: "ul",
  "host-controls": "div", start: "button", wait: "p", game: "section", arena: "div", banner: "div", scores: "ol",
  next: "button", hud: "p",
};
const HIDDEN_AT_REST = ["room-info", "invite", "host-controls", "wait", "game", "banner", "next"];

// A page in miniature: one element per role, plus the touch buttons a game declares.
function page({ without = [], touch = ["turn=-1", "turn=1"], labels = {} } = {}) {
  const doc = fakeDocument();
  const nodes = {};
  for (const [role, tag] of Object.entries(ROLES)) {
    if (without.includes(role)) continue;
    const node = doc.createElement(tag);
    node.setAttribute("data-engine", role);
    node.textContent = labels[role] ?? "";
    node.hidden = HIDDEN_AT_REST.includes(role);
    nodes[role] = doc.body.appendChild(node);
  }
  const buttons = touch.map((value) => {
    const button = doc.createElement("button");
    button.setAttribute("data-engine-touch", value);
    return nodes.arena.appendChild(button);
  });
  return { doc, nodes, buttons };
}

function mount(options = {}, shape = {}) {
  const made = page(shape);
  const calls = [];
  const replaced = [];
  const box = { ...options.stored };
  const ui = mountUi({
    container: made.doc.body, title: "Owned", doc: made.doc,
    storage: { getItem: (k) => box[k] ?? null, setItem: (k, v) => { box[k] = String(v); } },
    where: { origin: "https://game.example", search: "", replaceState: (a, b, url) => replaced.push(url) },
    onCreate: (name) => calls.push(["create", name]),
    onJoin: (room, name) => calls.push(["join", room, name]),
    onStart: () => calls.push(["start"]),
    onTouch: (field, value) => calls.push(["touch", field, value]),
    ...options,
  });
  return { ...made, ui, calls, replaced, box };
}

test("the kit adopts the page's elements by role and builds no chrome", () => {
  const before = page();
  const count = (root) => { let n = 0; walk(root, () => { n += 1; }); return n; };
  const size = count(before.doc.body);
  const { ui, nodes, doc, calls } = mount({ stored: { "engine-name": "ann" } });
  assert.equal(ui.owned, true);
  assert.equal(ui.arena, nodes.arena);
  assert.equal(ui.hudNode, nodes.hud);
  // The diagnostics overlay is the one element the kit adds, inside the arena.
  assert.equal(count(doc.body), size + 1);
  assert.equal(ui.overlayNode.parentNode, nodes.arena);
  assert.equal(nodes.name.value, "ann", "the stored name is offered in the page's field");
  nodes.code.value = " abcd ";
  nodes.create.onclick(); nodes.join.onclick(); nodes.start.onclick();
  assert.deepEqual(calls, [["create", "ann"], ["join", "ABCD", "ann"], ["start"]]);
  ui.setStatus("ready"); ui.setHud("3 left"); ui.setMuteLabel(true);
  assert.deepEqual([nodes.status.textContent, nodes.hud.textContent, nodes.mute.textContent], ["ready", "3 left", "sound off"]);
});

test("a page that owns its look receives no theme, layout or root class from the kit", () => {
  const { doc } = mount();
  const styles = doc.head.children.filter((n) => n.tag === "style").map((n) => n.textContent).join("\n");
  assert.doesNotMatch(styles, /engine-root|engine-panel|engine-head|engine-row|--bg|--accent|font:16px|prefers-color-scheme/);
  assert.match(styles, /\.engine-layer\{/, "the canvas layers still fill the arena");
  assert.match(styles, /\.engine-overlay\{/);
  assert.equal(doc.body.classList.contains("engine-root"), false);
  assert.equal(doc.body.style.margin, undefined);
});

test("room-info, invite, host-controls and wait follow the role through the hidden attribute", () => {
  const host = mount();
  host.ui.showRoom({ room: "WXYZ", isHost: true, canStart: true });
  const hidden = (nodes) => Object.fromEntries(["room-info", "invite", "host-controls", "wait", "start"].map((role) => [role, nodes[role].hidden]));
  assert.deepEqual(hidden(host.nodes), { "room-info": false, invite: false, "host-controls": false, wait: true, start: false });
  assert.equal(host.nodes["room-code"].textContent, "WXYZ");
  assert.equal(host.nodes["invite-link"].href, "https://game.example/?room=WXYZ");
  assert.equal(host.nodes["invite-link"].textContent, "https://game.example/?room=WXYZ");
  assert.deepEqual(host.replaced, ["?room=WXYZ"]);
  assert.equal(host.nodes.create.disabled && host.nodes.join.disabled, true);

  const guest = mount();
  guest.ui.showRoom({ room: "WXYZ", isHost: false, canStart: false });
  assert.deepEqual(hidden(guest.nodes), { "room-info": false, invite: true, "host-controls": true, wait: false, start: true });
});

test("entering the game hides the lobby slot and reveals the game slot", () => {
  const { ui, nodes } = mount();
  assert.deepEqual([nodes.lobby.hidden, nodes.game.hidden], [false, true]);
  ui.enterGame();
  assert.deepEqual([nodes.lobby.hidden, nodes.game.hidden], [true, false]);
});

test("the banner and the next control are shown and hidden in place, keeping the page's label", () => {
  const { ui, nodes } = mount({}, { labels: { next: "Again · Space" } });
  ui.banner("Round 1");
  assert.deepEqual([nodes.banner.textContent, nodes.banner.hidden], ["Round 1", false]);
  ui.clearBanner();
  assert.equal(nodes.banner.hidden, true);
  ui.showNext(false);
  assert.deepEqual([nodes.next.textContent, nodes.next.hidden], ["Again · Space", true]);
  ui.showNext(true, "New match");
  assert.deepEqual([nodes.next.textContent, nodes.next.hidden], ["New match", false]);
});

test("a page's own touch buttons are bound through data-engine-touch", () => {
  const { buttons, calls, ui, doc } = mount({ intent: { turn: {} } });
  buttons[0].dispatch("pointerdown");
  buttons[0].dispatch("pointerup");
  buttons[1].dispatch("pointerdown");
  buttons[1].dispatch("pointercancel");
  buttons[1].dispatch("pointerleave");
  assert.deepEqual(calls, [["touch", "turn", -1], ["touch", "turn", 0], ["touch", "turn", 1], ["touch", "turn", 0]], "a leave after the release changes nothing");
  ui.enableTouch(true);
  assert.equal(doc.body.dataset.touch, "on", "the page's stylesheet reveals the buttons from this attribute");
});

test("a touch button naming an unknown intent field is refused by name", () => {
  assert.throws(() => mount({ intent: { turn: {} } }, { touch: ["jump=1"] }), /unknown intent field jump/);
});

test("touchControls passed to the kit are ignored when the page brings its own buttons", () => {
  const { nodes } = mount({ intent: { turn: {} }, touchControls: [{ field: "turn", value: 1, label: ">" }] });
  assert.equal(find(nodes.arena, (n) => n.classList.contains("engine-touch")), null);
});

test("score rows carry a swatch, a name and a score the page can style", () => {
  const { ui, nodes } = mount({ palette: ["#123456"] });
  ui.renderScores([{ name: "ann", score: 3, colour: "#abcdef" }, { name: "bob", alive: false }]);
  const [ann, bob] = nodes.scores.children;
  assert.deepEqual(ann.children.map((n) => [n.tag, n.className]), [["span", "swatch"], ["span", "name"], ["strong", "score"]]);
  assert.equal(ann.children[0].attributes.style, "background:#abcdef");
  assert.equal(ann.children[1].textContent, "ann", "punctuation between name and score belongs to the stylesheet");
  assert.equal(ann.children[2].textContent, "3");
  assert.equal(bob.className, "dead");
  assert.equal(bob.children[0].attributes.style, "background:#123456", "a seat without a colour takes the game's palette");
  assert.equal(bob.children[2].textContent, "0");
});

test("peer rows carry the host, self and channel state as classes and an attribute, not as kit copy", () => {
  const { ui, nodes } = mount();
  ui.renderPeers([
    { id: "1", name: "ann", connected: true, host: true, you: true },
    { id: "2", name: "bob", connected: true, channel: "open" },
    { id: "3", name: "cy", connected: false, spectator: true },
  ]);
  const [ann, bob, cy] = nodes.peers.children;
  assert.deepEqual([ann.className, ann.textContent, ann.attributes["data-channel"]], ["host you", "ann (you)", "none"]);
  assert.deepEqual([bob.className, bob.textContent, bob.attributes["data-channel"]], ["", "bob", "open"]);
  assert.equal(cy.textContent, "cy (watching) (away)");
});

test("optional slots may be absent; the kit keeps working with detached stand-ins", () => {
  const { ui, nodes } = mount({}, { without: ["banner", "invite", "room-info", "host-controls", "wait", "hud", "mute", "copy", "next", "status", "room-code"] });
  ui.showRoom({ room: "ABCD", isHost: true, canStart: true });
  ui.setStatus("x"); ui.setHud("y"); ui.showNext(true); ui.enterGame();
  ui.banner("Round 1");
  const banner = find(nodes.arena, (n) => n.attributes["data-engine"] === "banner");
  assert.equal(banner.textContent, "Round 1", "a missing banner is added to the arena");
  assert.equal(nodes.game.hidden, false);
});

test("without an arena slot the kit builds its default chrome and tags it with the same roles", () => {
  const doc = fakeDocument();
  const container = doc.body.appendChild(doc.createElement("div"));
  const ui = mountUi({ container, title: "Bare", doc, storage: null, where: { origin: "https://game.example", search: "" } });
  assert.equal(ui.owned, false);
  assert.ok(container.classList.contains("engine-root"));
  for (const role of ["name", "code", "create", "join", "start", "copy", "mute", "next", "status", "invite-link", "peers", "scores"]) {
    assert.ok(find(container, (n) => n.attributes["data-engine"] === role), `the default chrome has no ${role}`);
  }
  assert.match(doc.head.children.map((n) => n.textContent).join(""), /\.engine-root\{/);
});
