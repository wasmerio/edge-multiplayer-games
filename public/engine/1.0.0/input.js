// One input layer for keyboard, touch and gamepad. A game declares the intent
// it reads; the source emits only when the intent changes, and re-sends so a
// dropped message cannot leave an input stuck on.
import { INPUT_RESEND_INTERVAL_MS } from "./params.js";

const neutralOf = (intent) => Object.fromEntries(Object.entries(intent).map(([name, spec]) => [name, spec.neutral ?? 0]));

export function inputSource({ intent, bindings, onChange, deps = {} }) {
  if (!intent || !bindings) throw new Error("inputSource: intent and bindings are required");
  for (const field of Object.keys(bindings)) {
    if (!intent[field]) throw new Error(`inputSource: binding names unknown intent field ${field}`);
  }
  const claimed = new Map();
  for (const [field, binding] of Object.entries(bindings)) {
    for (const code of Object.keys(binding.keys || {})) {
      if (claimed.has(code)) {
        throw new Error(`inputSource: key ${code} is claimed by ${claimed.get(code)} and ${field}`);
      }
      claimed.set(code, field);
    }
  }

  const now = deps.now || (() => Date.now());
  const target = deps.target || (typeof window === "undefined" ? null : window);
  const gamepads = deps.gamepads || (() => (typeof navigator === "undefined" ? [] : navigator.getGamepads?.() || []));
  const hasTouch = deps.hasTouch ?? (() => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches === true);

  const held = new Set();
  const touches = new Map();
  let current = neutralOf(intent);
  let sentAt = 0;

  const clamp = (field, value) => {
    const spec = intent[field];
    if (spec.values) return spec.values.includes(value) ? value : (spec.neutral ?? spec.values[0]);
    const lo = spec.min ?? -1;
    const hi = spec.max ?? 1;
    if (!Number.isFinite(value)) throw new Error(`inputSource: field ${field} got ${value}`);
    return Math.max(lo, Math.min(hi, value));
  };

  function compute() {
    const next = neutralOf(intent);
    for (const [field, binding] of Object.entries(bindings)) {
      let value = next[field];
      for (const [code, contribution] of Object.entries(binding.keys || {})) {
        if (held.has(code)) value += contribution;
      }
      if (touches.has(field)) value += touches.get(field);
      for (const pad of gamepads()) {
        if (!pad) continue;
        if (binding.axis !== undefined) {
          const raw = pad.axes?.[binding.axis] ?? 0;
          if (Math.abs(raw) > (binding.deadZone ?? 0.3)) value += Math.sign(raw);
        }
        for (const [index, contribution] of Object.entries(binding.buttons || {})) {
          if (pad.buttons?.[index]?.pressed) value += contribution;
        }
      }
      next[field] = clamp(field, binding.discrete === false ? value : Math.sign(value) * Math.min(1, Math.abs(value)));
    }
    return next;
  }

  function settle(force = false) {
    const next = compute();
    const changed = Object.keys(next).some((field) => next[field] !== current[field]);
    const due = now() - sentAt >= INPUT_RESEND_INTERVAL_MS;
    if (!changed && !(force || due)) return current;
    current = next;
    sentAt = now();
    onChange?.({ ...current });
    return current;
  }

  // A key typed into a form field is text, never game input.
  const typing = (event) => /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || "") || event.target?.isContentEditable === true;
  const onKeyDown = (event) => {
    if (!claimed.has(event.code) || event.repeat || typing(event)) return;
    event.preventDefault?.();
    held.add(event.code);
    settle();
  };
  const onKeyUp = (event) => {
    if (!claimed.has(event.code)) return;
    held.delete(event.code);
    settle();
  };
  const onBlur = () => { held.clear(); touches.clear(); settle(true); };

  if (target) {
    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("keyup", onKeyUp);
    target.addEventListener("blur", onBlur);
  }

  return {
    current: () => ({ ...current }),
    settle,
    poll: () => settle(false),
    touch(field, value) {
      if (!intent[field]) throw new Error(`inputSource: touch names unknown intent field ${field}`);
      if (value === 0) touches.delete(field); else touches.set(field, value);
      settle();
    },
    releaseAll: onBlur,
    wantsTouchControls: () => hasTouch(),
    detach() {
      if (!target) return;
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", onBlur);
    },
  };
}
