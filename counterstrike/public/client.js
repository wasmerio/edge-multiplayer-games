import { defineSnapshot, startGame } from "@engine/engine.js";
import {
  Game, BINDINGS, COLORS, INTENT, MAP, REASONS, RULES, SHOP, SNAPSHOT, TEAMS, TICK_HZ, WEAPONS, cleanInput, inputOf,
} from "/game.js";
import { FirstPersonView } from "/renderer.js";

// In-arena overlays only; the page chrome is the engine's.
const CSS = `
.cs-arena [hidden]{display:none!important}
.cs-arena #crosshair{position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px;pointer-events:none;opacity:.85;
  background:linear-gradient(#fff,#fff) center/2px 100% no-repeat,linear-gradient(#fff,#fff) center/100% 2px no-repeat}
.cs-arena #crosshair.hit{background-image:linear-gradient(#f55,#f55),linear-gradient(#f55,#f55)}
.cs-arena #pointer-hint{position:absolute;left:50%;top:62%;transform:translateX(-50%);background:#000a;color:#fff;
  padding:8px 14px;border-radius:8px;pointer-events:none;font-size:.9rem;white-space:nowrap}
.cs-arena #timer{position:absolute;top:8px;left:50%;transform:translateX(-50%);background:#000a;color:#fff;
  padding:2px 10px;border-radius:6px;font:600 1.1rem ui-monospace,monospace}
.cs-arena #timer.danger{color:#ff7a59}
.cs-arena #stats{position:absolute;inset:auto 0 0 0;display:flex;flex-wrap:wrap;gap:2px 16px;align-items:center;
  padding:6px 10px;background:#000a;color:#fff;font-size:.85rem}
.cs-arena #stats b{font-size:1.05rem}
.cs-arena #stats button{min-height:32px;padding:2px 10px}
.cs-arena #objective{flex:1 1 100%;position:relative;color:#cfd6dd}
.cs-arena #action-progress{position:absolute;left:0;bottom:-4px;height:3px;width:0;background:#edb35c}
.cs-arena #buy-menu{position:absolute;inset:6% 8% auto;max-height:78%;overflow:auto;background:#11191cf2;color:#fff;
  border:1px solid #33424a;border-radius:10px;padding:12px}
.cs-arena .buy-head{display:flex;gap:12px;align-items:center;justify-content:space-between}
.cs-arena #buy-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:8px 0}
.cs-arena .buy-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left}
.cs-arena .buy-item small{color:#9aa7b0}
`;

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else if (key === "hidden") node.hidden = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
};
const setText = (node, value) => { const text = String(value); if (node.textContent !== text) node.textContent = text; };
const tenth = (value) => Math.round(value * 10) / 10;

function mount(arena, ctx) {
  document.head.append(el("style", { text: CSS }));
  arena.classList.add("cs-arena");
  arena.style.width = "min(1120px, 100%)";
  arena.style.aspectRatio = "16 / 9";

  const scene = el("canvas", { id: "scene", class: "engine-layer", "aria-label": "First-person 3D view. Click to capture the mouse." });
  const crosshair = el("div", { id: "crosshair", hidden: true });
  const hint = el("div", { id: "pointer-hint", hidden: true, text: "CLICK TO PLAY · mouse to look · Escape to release" });
  const timer = el("div", { id: "timer", hidden: true });
  const team = el("b", { id: "team-label" });
  const health = el("b", { id: "health" });
  const ammo = el("b", { id: "ammo" });
  const weaponLabel = el("span", { id: "weapon-label" });
  const armor = el("b", { id: "armor" });
  const money = el("b", { id: "money" });
  const kit = el("span", { id: "kit-status" });
  const buyToggle = el("button", { id: "buy-toggle", text: "Buy (B)" });
  const progress = el("div", { id: "action-progress" });
  const objectiveText = el("span", { text: "Get ready" });
  const objective = el("div", { id: "objective" }, [objectiveText, progress]);
  const stats = el("div", { id: "stats", hidden: true }, [
    team, el("span", {}, [health, " HP"]), el("span", {}, [weaponLabel, " ", ammo]),
    el("span", {}, ["Armor ", armor]), money, kit, buyToggle, objective,
  ]);
  const buyTime = el("span", { id: "buy-time" });
  const buyBalance = el("b", { id: "buy-balance" });
  const buyClose = el("button", { id: "buy-close", "aria-label": "Close buy menu", text: "✕" });
  const buyItems = el("div", { id: "buy-items" });
  const feedback = el("span", { id: "buy-feedback", role: "status", text: "Choose your equipment." });
  const buyMenu = el("section", { id: "buy-menu", role: "dialog", "aria-label": "Buy menu", hidden: true }, [
    el("div", { class: "buy-head" }, [el("span", {}, ["Loadout · ", buyTime]), buyBalance, buyClose]),
    buyItems, el("div", { class: "buy-head" }, [feedback, el("small", { text: "B / Esc to close" })]),
  ]);
  arena.prepend(scene, crosshair, hint, timer, stats, buyMenu);

  let view = null;
  try {
    view = new FirstPersonView(scene);
  } catch (error) {
    console.warn(error);
    ctx.hud("WebGL is unavailable. Enable hardware acceleration or use a browser with WebGL support.");
  }

  // `raw` is the newest authoritative snapshot; the HUD and every rule check read it.
  let raw = null;
  let roundNo = 0;
  let autoBuyRound = 0;
  let aim = 0;
  let pitch = 0;
  let firing = false;
  let ads = false;
  let pushedAt = 0;
  let killfeed = "";
  const locked = () => document.pointerLockElement === scene;
  const alive = () => !!raw && ctx.seat() >= 0 && raw.hp[ctx.seat()] > 0;
  const look = () => cleanInput(inputOf({ ...game.input.current(), aim, pitch, fire: firing ? 1 : 0 }));

  const pushLook = () => { ctx.intent("aim", aim); ctx.intent("pitch", pitch); pushedAt = performance.now(); };
  const setFire = (on) => { firing = on; pushLook(); ctx.intent("fire", on ? 1 : 0); };
  const release = () => { ads = false; if (firing) setFire(false); };

  function updateHint() {
    const active = alive() && !raw.over;
    hint.hidden = !active || !buyMenu.hidden || locked();
    crosshair.hidden = !active || !buyMenu.hidden;
  }

  function setBuy(open) {
    if (open && (!raw?.freeze || raw.over || !alive())) return;
    if (buyMenu.hidden === !open) return;
    buyMenu.hidden = !open;
    if (open) { release(); document.exitPointerLock?.(); feedback.textContent = ""; buyClose.focus(); }
    updateHint();
  }

  function updateBuy() {
    if (buyMenu.hidden) return;
    const mine = ctx.seat();
    setText(buyBalance, `$${raw.money[mine].toLocaleString()}`);
    setText(buyTime, `${Math.ceil(raw.freeze / TICK_HZ)}s remaining`);
    for (const button of buyItems.children) {
      const item = SHOP.find((entry) => entry.id === button.dataset.item);
      const weapon = WEAPONS.findIndex((w) => w.id === item.id);
      const owned = weapon === raw.w[mine] || (item.id === "armor" && raw.armor[mine] === 100) || (item.id === "kit" && raw.kit[mine]);
      const restricted = item.id === "kit" && mine % 2 === 0;
      const poor = raw.money[mine] < item.price;
      button.disabled = owned || restricted || poor || !raw.freeze || raw.over;
      setText(button.lastChild, owned ? "EQUIPPED" : restricted ? "DEFENDERS ONLY" : poor ? "INSUFFICIENT FUNDS" : "BUY");
    }
  }

  for (const item of SHOP) {
    const button = el("button", { class: "buy-item", "data-item": item.id }, [
      el("strong", { text: `${item.name} · ${item.price ? `$${item.price.toLocaleString()}` : "FREE"}` }),
      el("small", { text: item.note }), el("span", { class: "buy-state", text: "BUY" }),
    ]);
    button.onclick = () => { feedback.textContent = "Purchasing…"; ctx.command({ t: "buy", item: item.id }); };
    buyItems.append(button);
  }
  buyToggle.onclick = () => setBuy(true);
  buyClose.onclick = () => setBuy(false);

  function hud(s) {
    const mine = ctx.seat();
    const has = mine >= 0;
    const weapon = WEAPONS[has ? s.w[mine] : 0];
    const seconds = Math.ceil((s.freeze > 0 ? s.freeze : s.bm === 1 ? s.bt : Math.max(0, s.left)) / TICK_HZ);
    timer.hidden = false;
    stats.hidden = false;
    setText(timer, `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);
    timer.classList.toggle("danger", s.bm === 1);
    setText(team, has ? TEAMS[mine % 2].toUpperCase() : "SPECTATOR");
    team.style.color = COLORS[mine % 2] || "#fff";
    setText(health, has ? s.hp[mine] : "—");
    setText(ammo, has ? `${s.ammo[mine]} / ${weapon.magazine}` : "—");
    setText(weaponLabel, weapon.name);
    setText(armor, has ? s.armor[mine] : 0);
    setText(money, has ? `$${s.money[mine].toLocaleString()}` : "—");
    setText(kit, has && s.kit[mine] ? "DEFUSE KIT" : "");
    if (!s.over) {
      let text = s.bm === 1 ? `BOMB PLANTED · ${mine % 2 === 1 ? "Hold E near the bomb to defuse" : "Protect the bomb"}`
        : mine % 2 === 0 ? (s.bc === mine ? "You have the bomb · Hold E at A or B to plant" : "Cover your carrier · Take a bombsite")
          : "Defend A and B · Stop the attackers";
      if (!has) text = "Spectating";
      else if (s.hp[mine] <= 0) text = "Eliminated · Watching your team";
      else if (s.freeze > 0) text = `BUY PERIOD · ${Math.ceil(s.freeze / TICK_HZ)}s · B to buy weapons and equipment`;
      else if (s.rl[mine]) text = "Reloading…";
      setText(objectiveText, text);
    }
    const defuse = has && s.kit[mine] ? RULES.kitDefuse : RULES.defuse;
    const done = !has ? 0 : s.act[mine] ? s.act[mine] / (mine % 2 ? defuse : RULES.plant) : s.rl[mine] ? 1 - s.rl[mine] / weapon.reload : 0;
    progress.style.width = `${done * 100}%`;
    if (s.d.length) killfeed = s.d.map((i) => `${ctx.players()[i].name} eliminated`).join(" · ");
    const squad = ctx.players().map((p, i) => `${p.name} (${TEAMS[i % 2][0]}) ${s.kills[i]}K${s.hp[i] > 0 ? "" : " out"}`).join("  ");
    ctx.hud(`${squad}${killfeed ? ` · ${killfeed}` : ""} · WASD move · R reload · E plant/defuse · right mouse: sights`);
    buyToggle.disabled = !alive() || !s.freeze || s.over;
    if (s.freeze > 0 && !s.over && alive() && autoBuyRound !== roundNo) { autoBuyRound = roundNo; setBuy(true); }
    if (!s.freeze || s.over || !alive()) setBuy(false);
    updateBuy();
    updateHint();
  }

  window.addEventListener("keydown", (event) => {
    if (!raw || /INPUT|TEXTAREA/.test(event.target.tagName)) return;
    if (event.code === "KeyB" && !event.repeat) { event.preventDefault(); setBuy(buyMenu.hidden); }
    else if (event.code === "Escape") { setBuy(false); release(); }
  });
  window.addEventListener("blur", release);
  document.addEventListener("pointerlockchange", () => { if (!locked()) release(); updateHint(); });
  document.addEventListener("mousemove", (event) => {
    if (!locked() || !buyMenu.hidden) return;
    // Ignore cursor warps when the browser captures the mouse again.
    if (Math.abs(event.movementX) > 500 || Math.abs(event.movementY) > 500) return;
    const sensitivity = ads ? 0.075 : 0.14;
    aim = tenth((aim + event.movementX * sensitivity + 360) % 360);
    pitch = tenth(Math.max(-75, Math.min(75, pitch - event.movementY * sensitivity)));
  });
  // Mouse events report every button change, including overlapping presses.
  function updateMouseButtons(event) {
    const active = locked() && buyMenu.hidden && alive() && !raw.over;
    const fire = active && (event.buttons & 1) !== 0;
    ads = active && (event.buttons & 2) !== 0;
    if (fire !== firing) setFire(fire);
  }
  scene.addEventListener("mousedown", async (event) => {
    if (!buyMenu.hidden || !alive() || raw.over) return;
    if (!locked()) {
      try { await scene.requestPointerLock(); } catch { hint.textContent = "Click to capture the mouse. Escape releases it."; }
      return;
    }
    event.preventDefault();
    updateMouseButtons(event);
  });
  window.addEventListener("mouseup", updateMouseButtons);
  scene.addEventListener("contextmenu", (event) => event.preventDefault());

  return {
    renderer: () => view,
    local: () => ({ look: look(), ads, round: roundNo, raw }),
    lobby(msg) { view?.setup(msg.players, ctx.seat()); view?.resize(); },
    round(msg) {
      roundNo = msg.n;
      raw = null;
      killfeed = "";
      aim = ctx.seat() % 2 ? 180 : 0;
      pitch = 0;
      ads = false;
      setFire(false);
      view?.clearEffects();
    },
    snapshot(snap) { raw = snap; view?.tick(snap); hud(snap); },
    over(msg) {
      setBuy(false);
      document.exitPointerLock?.();
      ctx.banner(msg.winner < 0 ? `${TEAMS[raw.rt]} win the round` : `${TEAMS[msg.winner]} win the match`);
      setText(objectiveText, `${REASONS[raw.rr]} · ${ctx.isHost() ? "Space for the next round" : "Waiting for the host"}`);
    },
    reply(data) { if (data?.t === "purchase") feedback.textContent = data.reason; },
    draw(sample) {
      const now = performance.now();
      // Mouse look is coalesced to one update per tick.
      if (now - pushedAt >= 1000 / TICK_HZ) pushLook();
      view?.update(sample, ctx.isHost());
      view?.render(now, look(), ads);
      crosshair.classList.toggle("hit", now < (view?.hitUntil || 0));
    },
  };
}

const game = startGame({
  title: "Counterstrike: Breach",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  bindings: BINDINGS,
  tickHz: TICK_HZ,
  minPlayers: 2,
  arena: () => ({ ...MAP }),
  target: () => 5,
  // Scores belong to the two teams, not to players.
  scoreboard: (players, scores) => TEAMS.map((name, i) => ({ name, colour: COLORS[i], score: scores[i] ?? 0 })),
  onCommand: (sim, seat, data) => (data?.t === "buy" ? { t: "purchase", ...sim.buy(seat, String(data.item)) } : undefined),
  mount,
});
window.breach = game;
