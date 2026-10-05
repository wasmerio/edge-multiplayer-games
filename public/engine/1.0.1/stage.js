// Where a game's pixels come from. The default is the engine's 2D surface and
// a draw function. A game with its own renderer mounts it into the arena
// element instead and receives the same stream through optional hooks.
const HOOKS = ["lobby", "round", "over", "snapshot", "reply", "draw"];

export function createStage({ mount, draw, arena, context, makeSurface }) {
  if (typeof mount === "function") {
    const view = mount(arena, context);
    if (!view || typeof view.draw !== "function") {
      throw new Error("startGame: mount must return an object with draw(snapshot, ctx)");
    }
    const stage = { custom: true, view, surface: null };
    for (const name of HOOKS) stage[name] = (value) => view[name]?.(value, context);
    return stage;
  }
  if (typeof draw !== "function") throw new Error("startGame: draw must be a function");
  const surface = makeSurface();
  return {
    custom: false, view: null, surface,
    lobby: (msg) => surface.setArena(msg.opts.arena),
    round: () => surface.clearAll(),
    over: () => {},
    snapshot: () => {},
    reply: () => {},
    draw: (snapshot) => draw(surface, snapshot, context),
  };
}
