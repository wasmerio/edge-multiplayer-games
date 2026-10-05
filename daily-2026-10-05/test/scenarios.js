export const scenarios = [
  {
    name: "Broadcast accuracy, wraparound and one-shot scoring",
    run(Game, assert) {
      const g = new Game(4);
      g.startRound();
      g.freeze = 0;
      g.aim = 359;
      g.tick = 73;
      [1, 19, 40, 337].forEach((a, i) => { g.players[i].angle = a; });
      let s = g.step([0, 0, 0, 0]);
      assert(s.d.length === 0 && g.scores.every(v => v === 0), "No points before the pulse");
      s = g.step([0, 0, 0, 0]);
      assert(JSON.stringify(g.scores) === '[3,1,0,1]', "Center across zero, outer arc, miss and inclusive edge score correctly");
      assert(s.a[0] === 359 && s.b === 1, "Scoring snapshot retains the scored target");
      assert(JSON.stringify(s.d) === '[[0,3],[1,1],[2,0],[3,1]]', "Events include misses and all simultaneous awards");
      assert(s.p[0][2] === 3 && s.q[0] === 3, "Snapshot carries round and match totals");
      const next = s.a[1];
      s = g.step([0, 0, 0, 0]);
      assert(s.a[0] === next && s.d.length === 0 && g.scores[0] === 3, "Next tick hops target without duplicate scoring");
    },
  },
  {
    name: "Momentum, neutral braking, malformed intent and disconnect",
    run(Game, assert) {
      const g = new Game(2);
      g.startRound();
      for (let i = 0; i < 30; i++) g.step([1, -1]);
      assert(g.tick === 0 && g.players[0].angle === 270, "Ready countdown blocks movement");
      for (let i = 0; i < 20; i++) g.step([1, -1]);
      assert(g.players[0].velocity === 5 && g.players[1].velocity === -5, "Acceleration is capped in both directions");
      for (let i = 0; i < 30; i++) g.step([0, Infinity]);
      assert(g.players.every(p => p.velocity === 0), "Neutral and invalid input brake to rest");
      assert(g.players.every(p => p.angle >= 0 && p.angle < 360), "Angles wrap within the circle");
      g.disconnect(1);
      g.tick = 74;
      g.players.forEach(p => { p.angle = g.aim; p.velocity = 0; });
      const s = g.step([0, 0]);
      assert(s.q[0] === 3 && s.q[1] === 0 && s.p[1][3] === 0, "Disconnected antennas cannot score");
      g.scores[1] = 99;
      assert(g.winner(3) === 0, "Disconnected player is ineligible to win");
      g.startRound();
      assert(!g.active[1] && g.players[0].velocity === 0 && g.players[0].points === 0, "Round reset keeps disconnects but clears dynamics");
    },
  },
  {
    name: "Ten-pulse lifecycle, tie handling and eight-player snapshot budget",
    run(Game, assert) {
      const g = new Game(8);
      g.startRound();
      let pulses = 0;
      let maxBytes = 0;
      let s;
      for (let i = 0; i < 780; i++) {
        const aim = g.tick > 0 && g.tick % 75 === 0 ? g.nextAim : g.aim;
        for (const p of g.players) { p.angle = aim; p.velocity = 0; }
        s = g.step(new Array(8).fill(0));
        if (s.d.length) pulses++;
        maxBytes = Math.max(maxBytes, JSON.stringify(s).length);
        if (i < 779) assert(!s.over, "Round must not end before the tenth pulse");
      }
      assert(pulses === 10 && g.tick === 750 && s.over, "Exactly ten broadcasts and 25 active seconds");
      assert(g.scores.every(v => v === 30), "Perfect aim earns thirty per round");
      assert(maxBytes < 900, "Eight-player snapshots stay below 100 bytes/player plus overhead");
      assert(g.winner(30) === -1, "A tie cannot win the match");
      const before = JSON.stringify(g.scores);
      s = g.step([1]);
      assert(s.over && !s.d.length && JSON.stringify(g.scores) === before, "Finished rounds cannot award again");
      g.scores[0] = 60;
      assert(g.winner(60) === 0 && g.winner(61) === -1, "Unique winner must reach the threshold");
      g.startRound();
      assert(g.round === 2 && g.tick === 0 && !g.roundOver && g.broadcasts === 0, "Next round resets lifecycle");
      assert(g.scores[0] === 60 && g.players.every(p => p.points === 0 && p.angle === 270), "Totals survive; per-round state resets");
    },
  },
];
