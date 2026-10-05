// A game draws through this surface and names no backend. The arena geometry
// comes from the lobby message so every peer draws the same board.
import { MAX_PIXEL_RATIO } from "./params.js";

export const TEXT_FAMILY = "system-ui, sans-serif";

export function createSurface({ container, layers = ["world", "actors"], palette = [], pixelRatio }) {
  if (!container) throw new Error("createSurface: container is required");
  const canvases = new Map();
  const contexts = new Map();
  let size = { w: 0, h: 0 };
  let ratio = 1;

  for (const name of layers) {
    const canvas = document.createElement("canvas");
    canvas.dataset.layer = name;
    canvas.className = "engine-layer";
    container.appendChild(canvas);
    canvases.set(name, canvas);
    contexts.set(name, canvas.getContext("2d"));
  }

  const ctx = (layer) => {
    const found = contexts.get(layer);
    if (!found) throw new Error(`surface: unknown layer ${layer}`);
    return found;
  };

  // A colour is any CSS colour string, or a gradient: { linear: [x0, y0, x1, y1], stops } or { radial: [x0, y0, r0, x1, y1, r1], stops }.
  const paint = (c, colour) => {
    if (colour === null || typeof colour !== "object") return colour;
    const along = colour.radial ?? colour.linear;
    if (!Array.isArray(along) || along.length !== (colour.radial ? 6 : 4) || !Array.isArray(colour.stops) || colour.stops.length < 2) {
      throw new Error("surface: a gradient needs linear [x0, y0, x1, y1] or radial [x0, y0, r0, x1, y1, r1], and at least two stops");
    }
    const gradient = colour.radial ? c.createRadialGradient(...along) : c.createLinearGradient(...along);
    for (const [at, stop] of colour.stops) gradient.addColorStop(at, stop);
    return gradient;
  };

  // `alpha`, `glow` and `rotate` apply to one call and are undone after it.
  const styled = (c, { alpha, glow, rotate, cx = 0, cy = 0 }, body) => {
    if (alpha === undefined && !glow && !rotate) { body(); return; }
    c.save();
    if (rotate) { c.translate(cx, cy); c.rotate(rotate); c.translate(-cx, -cy); }
    if (alpha !== undefined) c.globalAlpha = Math.max(0, Math.min(1, alpha));
    if (glow) {
      c.shadowColor = glow.colour ?? "#fff";
      c.shadowBlur = (glow.blur ?? 12) * ratio;
      c.shadowOffsetX = (glow.x ?? 0) * ratio;
      c.shadowOffsetY = (glow.y ?? 0) * ratio;
    }
    body();
    c.restore();
  };

  return {
    setArena({ w, h }) {
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        throw new Error(`surface: arena must be positive, got ${w}x${h}`);
      }
      size = { w, h };
      // The backing store follows the screen's pixel density; coordinates stay in arena units.
      const wanted = pixelRatio ?? globalThis.devicePixelRatio ?? 1;
      ratio = Number.isFinite(wanted) && wanted > 0 ? Math.min(MAX_PIXEL_RATIO, wanted) : 1;
      for (const [name, canvas] of canvases) {
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
        if (ratio !== 1) contexts.get(name).setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      container.style.aspectRatio = `${w} / ${h}`;
      container.style.width = `min(${w}px, 100%)`;
      // For a stylesheet that fits the board to the viewport height.
      container.style.setProperty?.("--arena-w", String(w));
      container.style.setProperty?.("--arena-h", String(h));
    },
    arena: () => ({ ...size }),
    pixelRatio: () => ratio,
    // CSS pixels per arena unit: 1 on a wide screen, less when the page is narrower than the board.
    scale: () => (size.w && container.clientWidth ? container.clientWidth / size.w : 1),
    colour: (index) => palette[index % Math.max(1, palette.length)] || "#ffffff",
    clear(layer) { ctx(layer).clearRect(0, 0, size.w, size.h); },
    trail(layer, from, to, { colour, width = 6, alpha, glow }) {
      const c = ctx(layer);
      styled(c, { alpha, glow }, () => {
        c.strokeStyle = paint(c, colour);
        c.lineWidth = width;
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(from.x, from.y);
        c.lineTo(to.x, to.y);
        c.stroke();
      });
    },
    disc(layer, { x, y, r, colour, stroke, alpha, glow }) {
      const c = ctx(layer);
      styled(c, { alpha, glow }, () => {
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        if (stroke) { c.strokeStyle = paint(c, colour); c.lineWidth = stroke; c.stroke(); }
        else { c.fillStyle = paint(c, colour); c.fill(); }
      });
    },
    // `radius` rounds the corners; `rotate` turns the box about its centre.
    box(layer, { x, y, w, h, colour, stroke, radius, rotate, alpha, glow }) {
      const c = ctx(layer);
      styled(c, { alpha, glow, rotate, cx: x + w / 2, cy: y + h / 2 }, () => {
        if (radius > 0) {
          const r = Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2);
          c.beginPath();
          c.moveTo(x + r, y);
          c.arcTo(x + w, y, x + w, y + h, r);
          c.arcTo(x + w, y + h, x, y + h, r);
          c.arcTo(x, y + h, x, y, r);
          c.arcTo(x, y, x + w, y, r);
          c.closePath();
          if (stroke) { c.strokeStyle = paint(c, colour); c.lineWidth = stroke; c.stroke(); }
          else { c.fillStyle = paint(c, colour); c.fill(); }
        } else if (stroke) { c.strokeStyle = paint(c, colour); c.lineWidth = stroke; c.strokeRect(x, y, w, h); }
        else { c.fillStyle = paint(c, colour); c.fillRect(x, y, w, h); }
      });
    },
    // `outline` draws a stroke under the fill; `family` replaces the system face; `rotate` turns about (x, y).
    text(layer, {
      x, y, value, colour = "#fff", size: px = 16, align = "left", weight, maxWidth,
      family = TEXT_FAMILY, baseline = "alphabetic", italic = false, outline, spacing, rotate, alpha, glow,
    }) {
      const c = ctx(layer);
      styled(c, { alpha, glow, rotate, cx: x, cy: y }, () => {
        c.font = `${italic ? "italic " : ""}${weight ? `${weight} ` : ""}${px}px ${family}`;
        c.textAlign = align;
        c.textBaseline = baseline;
        const args = maxWidth === undefined ? [String(value), x, y] : [String(value), x, y, maxWidth];
        let put = (method) => c[method](...args);
        if (spacing) {
          // Letter-spacing is laid out here, one character at a time, so it is the same in every browser.
          const chars = [...String(value)];
          const widths = chars.map((char) => c.measureText(char).width);
          const total = widths.reduce((sum, width) => sum + width, 0) + spacing * (chars.length - 1);
          const start = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
          c.textAlign = "left";
          put = (method) => { let at = start; chars.forEach((char, i) => { c[method](char, at, y); at += widths[i] + spacing; }); };
        }
        if (outline) {
          c.strokeStyle = paint(c, outline.colour ?? "#000");
          c.lineWidth = outline.width ?? 3;
          c.lineJoin = "round";
          put("strokeText");
        }
        c.fillStyle = paint(c, colour);
        put("fillText");
      });
    },
    // Filled unless `stroke` gives a line width; `closed: false` leaves a polyline open.
    poly(layer, { points, colour, stroke, closed = true, dash, rotate, alpha, glow }) {
      if (!Array.isArray(points) || points.length < 2) throw new Error("surface: poly needs at least two points");
      const c = ctx(layer);
      // A polygon turns about the centre of its bounding box.
      const xs = rotate ? points.map((p) => p.x) : [0];
      const ys = rotate ? points.map((p) => p.y) : [0];
      const centre = { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
      styled(c, { alpha, glow, rotate, ...centre }, () => {
        c.beginPath();
        points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
        if (closed) c.closePath();
        if (stroke) {
          c.strokeStyle = paint(c, colour); c.lineWidth = stroke; c.lineCap = "butt";
          c.setLineDash(dash || []); c.stroke(); c.setLineDash([]);
        } else { c.fillStyle = paint(c, colour); c.fill(); }
      });
    },
    ellipse(layer, { x, y, rx, ry, colour, stroke, rotate, alpha, glow }) {
      const c = ctx(layer);
      styled(c, { alpha, glow, rotate, cx: x, cy: y }, () => {
        c.beginPath();
        c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        if (stroke) { c.strokeStyle = paint(c, colour); c.lineWidth = stroke; c.stroke(); }
        else { c.fillStyle = paint(c, colour); c.fill(); }
      });
    },
    // A stroked circular arc, angles in radians clockwise from the x axis.
    arc(layer, { x, y, r, from, to, colour, width = 2, dash, alpha, glow }) {
      const c = ctx(layer);
      styled(c, { alpha, glow }, () => {
        c.strokeStyle = paint(c, colour); c.lineWidth = width; c.lineCap = "butt";
        c.setLineDash(dash || []);
        c.beginPath();
        c.arc(x, y, r, from, to);
        c.stroke();
        c.setLineDash([]);
      });
    },
    // Shifts every layer by arena units without redrawing: screen shake. shake(0, 0) resets.
    shake(dx = 0, dy = 0) {
      const value = dx || dy ? `translate(${(dx / size.w) * 100}%, ${(dy / size.h) * 100}%)` : "";
      for (const canvas of canvases.values()) { if (canvas.style) canvas.style.transform = value; }
    },
    canvas: (layer) => canvases.get(layer),
    layers: () => [...canvases.keys()],
    clearAll() { for (const name of canvases.keys()) this.clear(name); },
  };
}

// Arena area grows with the player count so a full room is not cramped.
export function arenaFor(players, { baseW = 800, baseH = 600, perPlayer = 0.35, scale = 1 } = {}) {
  const factor = Math.sqrt((1 + Math.max(0, players - 1) * perPlayer) * scale);
  const snap = (value) => Math.round(value / 4) * 4;
  return { w: snap(baseW * factor), h: snap(baseH * factor) };
}
