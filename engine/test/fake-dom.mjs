// The least DOM the UI kit needs, so the kit is tested without a browser.
// getElementById throws: the kit must only read elements it created.
export function fakeDocument() {
  const listeners = new Map();
  const node = (tag) => {
    const classes = new Set();
    const self = {
      tag, children: [], attributes: {}, dataset: {}, style: {}, parentNode: null, textContent: "", value: "", listeners: new Map(),
      get className() { return [...classes].join(" "); },
      set className(value) { classes.clear(); for (const name of String(value).split(/\s+/).filter(Boolean)) classes.add(name); },
      classList: {
        add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name),
        toggle: (name, on) => ((on ?? !classes.has(name)) ? classes.add(name) : classes.delete(name)),
      },
      setAttribute(key, value) { self.attributes[key] = String(value); if (key === "value") self.value = String(value); },
      getAttribute: (key) => self.attributes[key] ?? null,
      appendChild(child) { child.parentNode = self; self.children.push(child); return child; },
      append(...nodes) { for (const child of nodes) self.appendChild(child); },
      replaceChildren(...nodes) { self.children = []; self.append(...nodes); },
      addEventListener(type, fn) { self.listeners.set(type, [...(self.listeners.get(type) || []), fn]); },
      dispatch(type, event = {}) { for (const fn of self.listeners.get(type) || []) fn({ preventDefault() {}, ...event }); },
    };
    return self;
  };
  const doc = {
    head: node("head"), body: node("body"),
    createElement: node,
    getElementById() { throw new Error("the kit must not look an element up by id"); },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); },
    dispatch(type, event = {}) { for (const fn of listeners.get(type) || []) fn({ preventDefault() {}, ...event }); },
  };
  return doc;
}

export const walk = (node, visit) => { visit(node); for (const child of node.children) walk(child, visit); };
export const find = (root, test) => { let hit = null; walk(root, (n) => { if (!hit && test(n)) hit = n; }); return hit; };
export const textOf = (root) => { let out = ""; walk(root, (n) => { out += n.textContent ? `${n.textContent}\n` : ""; }); return out; };
