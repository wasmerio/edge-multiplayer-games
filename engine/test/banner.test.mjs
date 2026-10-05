// A timed banner must not hide the banner that replaced it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountUi } from "../ui.js";
import { fakeDocument, find } from "./fake-dom.mjs";

function mounted() {
  const doc = fakeDocument();
  const ui = mountUi({ container: doc.body, title: "t", doc, storage: null, where: { origin: "o", search: "" } });
  const banner = find(doc.body, (n) => n.classList.contains("engine-banner"));
  return { ui, shown: () => !banner.classList.contains("engine-hidden"), text: () => banner.textContent };
}

test("a timed banner hides itself; a later banner or a clear cancels the pending hide", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { ui, shown, text } = mounted();
  ui.banner("Round 1", 1400);
  t.mock.timers.tick(1400);
  assert.equal(shown(), false);

  ui.banner("Round 2", 1400);
  t.mock.timers.tick(700);
  ui.banner("ann wins");
  t.mock.timers.tick(5000);
  assert.deepEqual([shown(), text()], [true, "ann wins"]);

  ui.banner("Round 3", 1400);
  ui.clearBanner();
  ui.banner("3");
  t.mock.timers.tick(5000);
  assert.deepEqual([shown(), text()], [true, "3"]);
});
