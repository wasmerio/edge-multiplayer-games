import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The surface appends its canvases after the kit's arena children, so without
// an explicit order an opaque layer hides the banner and swallows touches.
test("the banner, touch controls and overlay stack above the canvas layers", () => {
  const source = fs.readFileSync(new URL("../ui.js", import.meta.url), "utf8");
  const rule = source.match(/([^\n{}]*)\{z-index:1\}/);
  assert.ok(rule, "a stacking rule exists");
  for (const name of [".engine-banner", ".engine-touch", ".engine-overlay"]) {
    assert.ok(rule[1].split(",").includes(name), `${name} is raised`);
  }
  assert.ok(!/\.engine-layer\{[^}]*z-index/.test(source), "canvas layers keep the default order");
});
