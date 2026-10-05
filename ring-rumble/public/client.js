import { defineSnapshot, startGame } from "@engine/engine.js";
import { Game, BINDINGS, INTENT, SNAPSHOT, TICK_HZ, mapSize } from "/game.js";
import { ArenaView } from "/renderer.js";

const COLORS = ["#b3ff70", "#ad94ff", "#ff866b", "#6fdcff", "#ffcb65", "#ff82c8", "#6effcf", "#f2f0df"];
const $ = (id) => document.getElementById(id);
const setText = (id, value) => { const node = $(id); if (node.textContent !== value) node.textContent = value; };

function mount(stage, ctx) {
  let view = null;
  try {
    view = new ArenaView($("scene"));
  } catch (error) {
    console.warn(error);
    $("graphics-error").hidden = false;
    $("graphics-error").textContent = "3D graphics are unavailable. Enable WebGL or try another browser.";
  }

  // The kit redraws the peer list on every link change; the lobby copy follows it.
  const lobbyInfo = () => {
    const rows = [...$("peers").children];
    const ready = 1 + rows.filter((li) => li.dataset.channel === "open").length;
    setText("mapinfo", `${ready} / 8 fighters ready`);
    $("start").disabled = ready < 2 || !view;
    setText("rtc", rows.length > 1 ? rows.map((li) => li.textContent).join(" · ") : "No peers connected.");
  };
  new MutationObserver(lobbyInfo).observe($("peers"), { childList: true });

  let last = null;
  function renderScores() {
    const players = ctx.players();
    const list = $("scores");
    if (list.children.length !== players.length) {
      list.replaceChildren(...players.map((player) => {
        const li = document.createElement("li");
        li.style.setProperty("--fighter", player.colour);
        const name = document.createElement("span");
        name.className = "fighter-name";
        name.textContent = player.name;
        if (player.owner === ctx.selfId()) {
          const you = document.createElement("small");
          you.textContent = "YOU";
          name.append(" ", you);
        }
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        const damage = document.createElement("strong");
        damage.className = "damage";
        const wins = document.createElement("span");
        wins.className = "wins";
        li.append(swatch, name, damage, wins);
        return li;
      }));
    }
    players.forEach((player, i) => {
      const li = list.children[i];
      const out = last ? !last.alive[i] : false;
      li.classList.toggle("dead", out);
      const damage = out ? "OUT" : `${last?.dmg[i] ?? 0}%`;
      if (li.children[2].textContent !== damage) li.children[2].textContent = damage;
      const wins = `${player.score ?? 0} / ${ctx.target()}`;
      if (li.children[3].textContent !== wins) li.children[3].textContent = wins;
    });
  }

  return {
    renderer: () => view,
    renderScores,
    lobby(msg) {
      $("scores").replaceChildren();
      $("hero-copy").hidden = true;
      stage.classList.add("playing");
      view?.setup(msg.opts.arena, msg.players, ctx.seat());
      renderScores();
    },
    round(msg) {
      last = null;
      setText("round-number", `ROUND ${String(msg.n).padStart(2, "0")}`);
      setText("round-hint", "");
      renderScores();
    },
    // Every tick: countdown, clock and damage, read from the uninterpolated stream.
    snapshot(snap) {
      const counting = snap.f > 0;
      if (counting) ctx.banner(String(Math.ceil(snap.f / TICK_HZ)));
      else if (!snap.over) {
        if (!last || last.f > 0) ctx.banner(null);
        setText("round-hint", snap.k >= 600 ? "The ring is shrinking. Stay inside!" : "Knock them off. Stay on.");
      }
      last = snap;
      setText("clock", counting ? "GET READY" : `${Math.max(0, 60 - Math.floor(snap.k / TICK_HZ))}s`);
      const own = ctx.seat();
      setText("dash-status", own < 0 ? "Spectating · join the next match" : !snap.alive[own] ? "You’re out · watch the fight"
        : snap.cd[own] ? `Dash ${(snap.cd[own] / TICK_HZ).toFixed(1)}s` : "Dash ready");
      renderScores();
    },
    over(msg) {
      const champion = msg.winner >= 0;
      const name = ctx.players()[champion ? msg.winner : last?.win]?.name;
      ctx.banner(name ? `${name} wins ${champion ? "the match!" : "the round!"}` : "Draw!");
      setText("round-hint", ctx.isHost() ? "Ready for another?" : "Waiting for the host…");
      renderScores();
    },
    draw(snap) { view?.draw(snap); },
  };
}

let game = null;
game = startGame({
  title: "Ring Rumble",
  container: document.body,
  Simulation: Game,
  schema: defineSnapshot(SNAPSHOT),
  intent: INTENT,
  bindings: BINDINGS,
  tickHz: TICK_HZ,
  minPlayers: 2,
  palette: COLORS,
  labels: { next: (matchOver) => (matchOver ? "Rematch · Space" : "Next round · Space") },
  arena: (players) => ({ w: 960, h: 600, ...mapSize(players) }),
  target: () => 5,
  // Wins arrive in the engine's score message; the rows are the page's own.
  scoreboard: (players) => { game?.view.renderScores(); return players; },
  mount,
});
window.rumble = game;
