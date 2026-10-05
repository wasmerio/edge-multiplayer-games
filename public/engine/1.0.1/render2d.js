// A game draws through this surface and names no backend. The arena geometry
// comes from the lobby message so every peer draws the same board.
export function createSurface({ container, layers = ["world", "actors"], palette = [] }) {
  if (!container) throw new Error("createSurface: container is required");
  const canvases = new Map();
  const contexts = new Map();
  let size = { w: 0, h: 0 };

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

  return {
    setArena({ w, h }) {
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        throw new Error(`surface: arena must be positive, got ${w}x${h}`);
      }
      size = { w, h };
      for (const canvas of canvases.values()) { canvas.width = w; canvas.height = h; }
      container.style.aspectRatio = `${w} / ${h}`;
      container.style.width = `min(${w}px, 100%)`;
    },
    arena: () => ({ ...size }),
    colour: (index) => palette[index % Math.max(1, palette.length)] || "#ffffff",
    clear(layer) { ctx(layer).clearRect(0, 0, size.w, size.h); },
    trail(layer, from, to, { colour, width = 6 }) {
      const c = ctx(layer);
      c.strokeStyle = colour;
      c.lineWidth = width;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(from.x, from.y);
      c.lineTo(to.x, to.y);
      c.stroke();
    },
    disc(layer, { x, y, r, colour }) {
      const c = ctx(layer);
      c.fillStyle = colour;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    },
    box(layer, { x, y, w, h, colour, stroke }) {
      const c = ctx(layer);
      if (stroke) { c.strokeStyle = colour; c.lineWidth = stroke; c.strokeRect(x, y, w, h); }
      else { c.fillStyle = colour; c.fillRect(x, y, w, h); }
    },
    text(layer, { x, y, value, colour = "#fff", size: px = 16, align = "left", weight, maxWidth }) {
      const c = ctx(layer);
      c.fillStyle = colour;
      c.font = `${weight ? `${weight} ` : ""}${px}px system-ui, sans-serif`;
      c.textAlign = align;
      if (maxWidth === undefined) c.fillText(String(value), x, y);
      else c.fillText(String(value), x, y, maxWidth);
    },
    // Filled unless `stroke` gives a line width; `closed: false` leaves a polyline open.
    poly(layer, { points, colour, stroke, closed = true, dash }) {
      if (!Array.isArray(points) || points.length < 2) throw new Error("surface: poly needs at least two points");
      const c = ctx(layer);
      c.beginPath();
      points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      if (closed) c.closePath();
      if (stroke) {
        c.strokeStyle = colour; c.lineWidth = stroke; c.lineCap = "butt";
        c.setLineDash(dash || []); c.stroke(); c.setLineDash([]);
      } else { c.fillStyle = colour; c.fill(); }
    },
    ellipse(layer, { x, y, rx, ry, colour, stroke }) {
      const c = ctx(layer);
      c.beginPath();
      c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      if (stroke) { c.strokeStyle = colour; c.lineWidth = stroke; c.stroke(); }
      else { c.fillStyle = colour; c.fill(); }
    },
    // A stroked circular arc, angles in radians clockwise from the x axis.
    arc(layer, { x, y, r, from, to, colour, width = 2, dash }) {
      const c = ctx(layer);
      c.strokeStyle = colour; c.lineWidth = width; c.lineCap = "butt";
      c.setLineDash(dash || []);
      c.beginPath();
      c.arc(x, y, r, from, to);
      c.stroke();
      c.setLineDash([]);
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
