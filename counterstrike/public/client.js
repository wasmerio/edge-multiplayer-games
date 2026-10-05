import { defineSnapshot, startGame } from "@engine/engine.js";
import {
  Game, BINDINGS, COLORS, INTENT, MAP, REASONS, RULES, SHOP, SNAPSHOT, TEAMS, TICK_HZ, WEAPONS, cleanInput, inputOf,
} from "/game.js";
import { FirstPersonView } from "/renderer.js";

const $ = (id) => document.getElementById(id);
const setText = (node, value) => { const text = String(value); if (node.textContent !== text) node.textContent = text; };
const tenth = (value) => Math.round(value * 10) / 10;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function mount(arena, ctx) {
  const scene = $("scene"), crosshair = $("crosshair"), hint = $("pointer-hint"), timer = $("timer");
  const team = $("team-label"), health = $("health"), ammo = $("ammo"), weaponLabel = $("weapon-label");
  const armor = $("armor"), money = $("money"), kit = $("kit-status"), buyToggle = $("buy-toggle");
  const progress = $("action-progress"), objective = $("objective"), killfeed = $("killfeed");
  const buyMenu = $("buy-menu"), buyTime = $("buy-time"), buyBalance = $("buy-balance"), buyClose = $("buy-close");
  const buyItems = $("buy-items"), feedback = $("buy-feedback"), banner = $("banner"), squad = $("scores");

  let view = null;
  try {
    view = new FirstPersonView(scene);
  } catch (error) {
    console.warn(error);
    $("graphics-error").hidden = false;
    $("graphics-error").textContent = "WebGL is unavailable. Enable hardware acceleration or use a browser with WebGL support.";
  }

  // The kit redraws the peer list on every link change; the lobby copy follows it.
  const lobbyInfo = () => {
    const links = [...$("peers").children].filter((li) => li.dataset.channel !== "none");
    const detail = links.map((li) => li.textContent).join(" · ");
    setText($("rtc"), detail);
    setText($("connection-detail"), detail || "Waiting for a friend to connect");
    $("start").disabled = !links.some((li) => li.dataset.channel === "open");
  };
  new MutationObserver(lobbyInfo).observe($("peers"), { childList: true });

  // `raw` is the newest authoritative snapshot; the HUD and every rule check read it.
  let raw = null;
  let roundNo = 0;
  let autoBuyRound = 0;
  let aim = 0;
  let pitch = 0;
  let firing = false;
  let ads = false;
  let pushedAt = 0;
  let squadSignature = "";
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
    if (open && (!banner.hidden || !raw?.freeze || raw.over || !alive())) return;
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
      setText(button.lastChild, owned ? "EQUIPPED" : restricted ? "DEFENDERS ONLY" : poor ? "INSUFFICIENT FUNDS" : "BUY →");
    }
  }

  for (const [i, item] of SHOP.entries()) {
    const button = el("button", "buy-item");
    button.dataset.item = item.id;
    const top = el("span", "item-top");
    top.append(el("span", "", `0${i + 1} / ${i < 4 ? "WEAPON" : "EQUIPMENT"}`), el("b", "", item.price ? `$${item.price.toLocaleString()}` : "FREE"));
    button.append(top, el("strong", "", item.name), el("span", "item-note", item.note), el("span", "buy-state", "BUY →"));
    button.onclick = () => { feedback.textContent = "Purchasing…"; ctx.command({ t: "buy", item: item.id }); };
    buyItems.append(button);
  }

  function renderSquad(s) {
    const players = ctx.players();
    const signature = JSON.stringify([ctx.selfId(), players.map((p) => p.name), s?.hp.map((hp) => hp === 0), s?.kills]);
    if (signature === squadSignature) return;
    squadSignature = signature;
    squad.replaceChildren(...players.map((p, i) => {
      const li = el("li", s?.hp[i] === 0 ? "dead" : "");
      const dot = el("span", "swatch");
      dot.style.background = COLORS[i % 2];
      li.append(dot, `${p.name}${p.owner === ctx.selfId() ? " (you)" : ""}`, el("b", "", s?.kills[i] ?? 0));
      return li;
    }));
  }
  buyToggle.onclick = () => setBuy(true);
  buyClose.onclick = () => setBuy(false);

  function hud(s) {
    const mine = ctx.seat();
    const has = mine >= 0;
    const weapon = WEAPONS[has ? s.w[mine] : 0];
    const seconds = Math.ceil((s.freeze > 0 ? s.freeze : s.bm === 1 ? s.bt : Math.max(0, s.left)) / TICK_HZ);
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
      if (!has) text = "Spectating · You can play in the next match";
      else if (s.hp[mine] <= 0) text = "Eliminated · Watching your team";
      else if (s.freeze > 0) text = `BUY PERIOD · ${Math.ceil(s.freeze / TICK_HZ)}s · B to buy weapons and equipment`;
      else if (s.rl[mine]) text = "Reloading…";
      setText(objective, text);
    }
    const defuse = has && s.kit[mine] ? RULES.kitDefuse : RULES.defuse;
    const done = !has ? 0 : s.act[mine] ? s.act[mine] / (mine % 2 ? defuse : RULES.plant) : s.rl[mine] ? 1 - s.rl[mine] / weapon.reload : 0;
    progress.style.width = `${done * 100}%`;
    if (s.d.length) setText(killfeed, s.d.map((i) => `${ctx.players()[i].name} eliminated`).join(" · "));
    renderSquad(s);
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
    lobby(msg) {
      view?.setup(msg.players, ctx.seat());
      view?.resize();
      setText($("room-tag"), `ROOM ${$("room-code").textContent}`);
      squadSignature = "";
      renderSquad(null);
    },
    round(msg) {
      roundNo = msg.n;
      raw = null;
      banner.hidden = true;
      killfeed.textContent = "";
      setText($("round-label"), `ROUND ${String(msg.n).padStart(2, "0")}`);
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
      const match = msg.winner >= 0;
      ctx.banner(match ? `${TEAMS[msg.winner]} win the match` : `${TEAMS[raw.rt]} win the round`);
      setText($("banner-subtitle"), `${REASONS[raw.rr]} · ${ctx.isHost() ? `Press Space to ${match ? "play again" : "continue"}` : "Waiting for host"}`);
      banner.hidden = false;
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
  palette: COLORS,
  labels: { next: (matchOver) => (matchOver ? "Play again →" : "Next round →") },
  title: "Counterstrike: Breach",
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  bindings: BINDINGS,
  tickHz: TICK_HZ,
  minPlayers: 2,
  arena: () => ({ ...MAP }),
  target: () => 5,
  // Scores belong to the two teams; the page shows them in its own top bar.
  scoreboard: (players, scores) => {
    setText($("attack-score"), scores[0] ?? 0);
    setText($("defend-score"), scores[1] ?? 0);
    return TEAMS.map((name, i) => ({ name, colour: COLORS[i], score: scores[i] ?? 0 }));
  },
  onCommand: (sim, seat, data) => (data?.t === "buy" ? { t: "purchase", ...sim.buy(seat, String(data.item)) } : undefined),
  mount,
});
window.breach = game;
