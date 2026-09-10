export const scenarios = [
  {
    name: "Shared crystals resolve independently; mines floor cargo and jam movement",
    run(Game, assert) {
      const g = new Game(2, { w: 560, h: 500, random: () => 0.8 });
      g.startRound();
      g.freeze = 0;
      g.tick = 1;
      g.objects = [[0, 500, 899, 3]];
      const gold = g.step([0, 0]);
      assert(gold.p.every(p => p[1] === 3), "Both stalls must catch their own copy of gold");
      assert(gold.d.length === 2 && gold.o.length === 0, "Each catch emits an event and consumes the object");
      g.players[1].x = 900;
      g.objects = [[1, 500, 899, -4]];
      const mine = g.step([0, 0]);
      assert(mine.p[0][1] === 0 && mine.p[0][2] === 12, "Mine subtracts four, floors at zero, and jams for 12 ticks");
      assert(mine.p[1][1] === 3 && mine.p[1][2] === 0, "Distant player avoids the mine");
      for (let t = 0; t < 12; t++) g.step([1, 0]);
      assert(g.players[0].x === 500 && g.players[0].jam === 0, "Jam prevents exactly twelve movement ticks");
      g.step([1, 0]);
      assert(g.players[0].x === 518, "Movement resumes after the jam");
      assert(gold.p[0][1] === 3 && gold.p[0][2] === 0, "Later ticks cannot mutate old snapshots");
    },
  },
  {
    name: "Ready phase, input validation, basket bounds, and exact catch edge",
    run(Game, assert) {
      const g = new Game(2);
      g.startRound();
      for (let t = 0; t < 30; t++) g.step([-1, 1]);
      assert(g.tick === 0 && g.freeze === 0, "Thirty ready ticks precede the active clock");
      assert(g.players.every(p => p.x === 500), "Ready phase ignores movement");
      g.step([Infinity, "1"]);
      assert(g.players.every(p => p.x === 500), "Invalid intent is neutral");
      for (let t = 0; t < 30; t++) g.step([-1, 1]);
      assert(g.players[0].x === 85 && g.players[1].x === 915, "Baskets stay inside the stall");
      g.objects = [[99, 170, 899, 1], [100, 829, 899, 3]];
      g.step([0, 0]);
      assert(g.players[0].cargo === 1, "Exactly 85 units from center catches");
      assert(g.players[1].cargo === 0, "86 units from center misses");
    },
  },
  {
    name: "Timeout awards once, ties play on, and next round resets only shift state",
    run(Game, assert) {
      const g = new Game(2);
      g.startRound();
      g.freeze = 0;
      g.tick = 1049;
      g.players[0].cargo = 7;
      g.players[1].cargo = 2;
      const end = g.step([0, 0]);
      assert(end.over && end.k === 1050 && end.r.join() === "0", "Shift ends precisely at 35 active seconds");
      assert(g.scores.join() === "2,0" && end.d.some(e => e[0] === 0 && e[1] === 0), "Sole leader receives two points and a score event");
      const again = g.step([1, 1]);
      assert(g.scores.join() === "2,0" && again.d.length === 0, "Over ticks never award again");
      g.startRound();
      assert(g.round === 2 && g.tick === 0 && g.freeze === 30 && !g.roundOver, "Round advance resets lifecycle");
      assert(g.players.every(p => p.cargo === 0 && p.x === 500 && p.jam === 0) && !g.objects.length, "Round-local state is cleared");
      assert(g.scores[0] === 2, "Match points survive round advance");
      g.scores = [4, 4];
      g.tick = 1049; g.freeze = 0;
      g.players.forEach(p => p.cargo = 9);
      const tie = g.step([]);
      assert(tie.r.length === 2 && g.scores.join() === "5,5", "Tied positive leaders earn one each");
      assert(g.winner(5) === -1, "A tied match at target continues");
      g.startRound(); g.tick = 1049; g.freeze = 0;
      g.players[1].cargo = 1;
      g.step([]);
      assert(g.winner(5) === 1, "Unique leader beyond target wins the match");
    },
  },
  {
    name: "Disconnected and empty stalls cannot earn round awards",
    run(Game, assert) {
      const g = new Game(2);
      g.startRound(); g.tick = 1049; g.freeze = 0;
      g.players[0].cargo = 100;
      g.disconnect(0);
      const end = g.step([]);
      assert(end.r.length === 0 && g.scores.every(s => s === 0), "Offline cargo and zero active cargo award nobody");
      g.startRound();
      assert(!g.players[0].active, "Disconnected players do not reappear next round");
      g.tick = 1049; g.freeze = 0; g.players[1].cargo = 1;
      g.step([]);
      assert(g.scores[1] === 2 && g.scores[0] === 0, "Remaining active player can finish the match");
    },
  },
  {
    name: "Eight-player full replay has bounded complete snapshots and no lingering drops",
    run(Game, assert) {
      let seed = 123;
      const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      const g = new Game(8, { w: 1120, h: 1000, random });
      g.startRound();
      let maxBytes = 0, maxObjects = 0, last;
      for (let t = 0; t < 1080; t++) {
        last = g.step(Array.from({ length: 8 }, (_, i) => Math.floor(t / 25 + i) % 3 - 1));
        maxBytes = Math.max(maxBytes, JSON.stringify(last).length);
        maxObjects = Math.max(maxObjects, last.o.length);
      }
      assert(last.over && last.k === 1050 && last.o.length === 0, "Full match drains its shower and ends on schedule");
      assert(maxObjects <= 7 && maxBytes < 1000, "Shared shower and full player snapshots stay compact");
      assert(last.p.length === 8 && last.q.length === 8 && Array.isArray(last.d), "Snapshots contain every player's render and score state");
      assert(last.p.every(p => p.every(Number.isFinite)), "All player snapshot values are finite");
    },
  },
];
