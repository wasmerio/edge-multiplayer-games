export const scenarios = [
  {
    name: "Interrupted banking resets; completed banking preserves ore",
    run(Game, assert) {
      const g = new Game(2);
      g.startRound();
      let s;
      for (let i = 0; i < 50; i++) s = g.step([1, 0]);
      assert(s.p[0][0] === 50 && s.p[0][1] === 5, "Fifty drilling ticks yield five ore and fifty heat");
      for (let i = 0; i < 12; i++) s = g.step([-1, 0]);
      assert(s.p[0][2] === 12 && g.scores[0] === 0, "Partial deposit must not score");
      s = g.step([0, 0]);
      assert(s.p[0][2] === 0 && s.p[0][0] === 36, "Cooling resets banking and removes two heat");
      for (let i = 0; i < 23; i++) s = g.step([-1, 0]);
      assert(g.scores[0] === 0, "Bank cannot complete early");
      s = g.step([-1, 0]);
      assert(g.scores[0] === 5 && s.p[0][1] === 0, "Bank transfers the whole haul");
      assert(JSON.stringify(s.d) === "[[0,1,5]]", "Bank event contains player and amount");
      assert(g.scores[1] === 0 && s.p[1][0] === 0, "Idle opponent is unaffected");
    },
  },
  {
    name: "Meltdown at heat ninety destroys haul and locks drilling",
    run(Game, assert) {
      const g = new Game(2);
      g.startRound();
      let s;
      for (let i = 0; i < 89; i++) s = g.step([1, 0]);
      assert(s.p[0][0] === 89 && s.p[0][1] === 8 && s.p[0][3] === 0, "Survive through tick 89");
      s = g.step([1, 0]);
      assert(s.p[0][3] === 45 && s.p[0][1] === 0, "Tick 90 melts the haul");
      assert(JSON.stringify(s.d) === "[[0,2,8]]", "Meltdown reports eight lost ore");
      for (let i = 0; i < 45; i++) s = g.step([1, 0]);
      assert(s.p[0][0] === 0 && s.p[0][1] === 0 && s.p[0][3] === 0, "Lockout cools fully and ignores drilling");
      for (let i = 0; i < 10; i++) s = g.step([1, 0]);
      assert(s.p[0][0] === 20 && s.p[0][1] === 3, "Rich vein doubles heat and triples ore");
      assert(g.scores[0] === 0, "Lost and unbanked ore never scores");
    },
  },
  {
    name: "Closing, score persistence, ties and departure lifecycle",
    run(Game, assert) {
      const g = new Game(2);
      g.startRound();
      for (let i = 0; i < 10; i++) g.step([1, 1]);
      for (let i = 0; i < 24; i++) g.step([-1, -1]);
      assert(g.winner(1) === -1, "Equal bank totals cannot win");
      for (let i = 0; i < 10; i++) g.step([1, 0]);
      for (let i = 0; i < 24; i++) g.step([-1, 0]);
      assert(g.winner(2) === 0, "Unique leader meets target");
      while (g.tick < 890) g.step([0, 0]);
      let s;
      for (let i = 0; i < 10; i++) s = g.step([1, 0]);
      assert(s.over && s.k === 900 && s.p[0][1] === 0, "Closing discards unbanked haul at exactly 900");
      assert(s.d.some(e => e[1] === 3 && e[2] === 3), "Closing emits rich ore loss");
      const scores = JSON.stringify(g.scores);
      s = g.step([1, 1]);
      assert(s.k === 900 && s.d.length === 0 && JSON.stringify(g.scores) === scores, "Finished rounds are inert");
      g.disconnect(0);
      g.startRound();
      s = g.step([1, 1]);
      assert(g.round === 2 && s.k === 1 && !s.over, "Next round restarts the clock");
      assert(JSON.stringify(g.scores) === scores && s.p[0][5] === 0 && s.p[0][0] === 0, "Scores persist; disconnected rigs stay inactive");
      assert(g.winner(1) === 1, "Departed leader cannot win");
    },
  },
  {
    name: "Eight-player snapshots stay bounded and deterministic",
    run(Game, assert) {
      const a = new Game(8), b = new Game(8);
      a.startRound(); b.startRound();
      let largest = 0;
      for (let k = 0; k < 900; k++) {
        const inputs = Array.from({ length: 8 }, (_, i) => ((k + i * 9) % 110 < 55 ? 1 : -1));
        const s = a.step(inputs);
        const encoded = JSON.stringify(s);
        largest = Math.max(largest, encoded.length);
        assert(encoded === JSON.stringify(b.step(inputs)), "Same intent sequence must replay exactly");
        assert(s.p.every(p => p.length === 7 && p.every(Number.isInteger) && p[0] >= 0 && p[0] <= 90), "Snapshot arrays contain bounded integer state");
      }
      assert(largest < 800, `Eight-player snapshot exceeds bandwidth budget: ${largest}`);
      assert(a.roundOver, "Full multiplayer replay reaches closing");
    },
  },
];
