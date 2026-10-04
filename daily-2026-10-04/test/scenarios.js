export const scenarios = [
  {
    name: "ordered rings, countdown and straight sailing",
    run(Game, assert) {
      const g = new Game(2); g.startRound();
      const start = g.boats[0].x;
      for (let i = 0; i < 60; i++) g.step([0, 1]);
      assert(g.tick === 0 && g.boats[0].x === start, "Countdown must freeze motion");
      const b = g.boats[0];
      [b.x, b.y] = g.gates[1];
      g.step([0, 0]);
      assert(b.checkpoint === 0, "Cannot skip the first ring");
      [b.x, b.y] = g.gates[0];
      let snap = g.step([0, 0]);
      assert(b.checkpoint === 1 && snap.d.some(([i, e]) => i === 0 && e === 1), "First ring emits checkpoint event");
      g.step([0, 0]);
      assert(b.checkpoint === 1, "Remaining inside a ring must not count twice");
      [b.x, b.y] = g.gates[1];
      g.step([0, 0]);
      assert(b.checkpoint === 2, "Second ring is accepted in order");
      assert(g.boats[1].speed > 0, "Neutral input sails forward");
    },
  },
  {
    name: "reef and shore collisions recover instead of eliminating",
    run(Game, assert) {
      const g = new Game(2); g.startRound(); g.freeze = 0;
      const b = g.boats[0];
      b.x = 0.974; b.y = 0.5; b.a = 0; b.speed = 0.0036;
      const s = g.step([0, 0]);
      assert(b.x === 0.975 && b.stun === 24, "Shore clamps boat and applies slowdown");
      assert(Math.cos(b.a) < 0 && b.active, "Boat reflects away from shore and remains active");
      assert(s.d.some(([i, e]) => i === 0 && e === 2), "Collision event is sent");
      const [x, y, r] = g.reefs[0]; b.x = x; b.y = y; b.a = 0;
      g.step([0, 0]);
      assert(Math.hypot(b.x - x, b.y - y) >= r + 0.012, "Boat is pushed outside reef");
      b.x = 0.5; b.y = 0.82; b.a = 0;
      for (let i = 0; i < 30; i++) g.step([0, 0]);
      assert(b.stun === 0 && b.speed > 0.001, "Slowdown wears off");
    },
  },
  {
    name: "full two-lap race, scoring once and round reset",
    run(Game, assert) {
      const g = new Game(2); g.startRound();
      let snap;
      for (let i = 0; i < 1900 && !g.roundOver; i++) {
        const b = g.boats[0];
        const [x, y] = g.gates[b.checkpoint % 6];
        const angle = Math.atan2(y - b.y, x - b.x) - b.a;
        const error = Math.atan2(Math.sin(angle), Math.cos(angle));
        snap = g.step([Math.abs(error) < 0.05 ? 0 : Math.sign(error), 0]);
      }
      assert(g.boats[0].checkpoint === 12 && g.boats[0].finish > 0, "Steering can finish two laps within the deadline");
      assert(g.roundOver && snap.over, "Race must terminate");
      assert(g.scores[0] === 3 && g.scores[1] === 0, "First finisher earns three points");
      assert(g.winner(3) === 0, "Unique match leader wins");
      assert(snap.d.some(([i, e]) => i === 0 && e === 4), "End snapshot contains award event");
      for (let i = 0; i < 10; i++) g.step([0, 0]);
      assert(g.scores[0] === 3, "Repeated post-round steps cannot award again");
      g.startRound();
      assert(g.round === 2 && g.scores[0] === 3 && g.boats[0].checkpoint === 0 && g.freeze === 60, "New race resets progress but keeps score");
    },
  },
  {
    name: "timeout ties, disconnected boats and self-contained snapshots",
    run(Game, assert) {
      const g = new Game(8); g.startRound(); g.freeze = 0; g.deadline = 1;
      for (const b of g.boats) { b.x = 0.5; b.y = 0.82; b.checkpoint = 2; }
      g.disconnect(7);
      const snap = g.step(Array(8).fill(0));
      assert(g.roundOver && g.scores.slice(0, 7).every((s) => s === 3), "Exact timeout ties share the award");
      assert(g.scores[7] === 0 && g.winner(3) === -1, "Disconnected boats cannot score; tied match continues");
      assert(JSON.stringify(snap).length < 2000 && JSON.stringify(snap.p).length < 800, "Snapshot meets bandwidth budget at eight players");
      assert(snap.gates.length === 6 && snap.reefs.length === 3 && snap.scores.length === 8, "Snapshot carries geometry, progress and scores");
      g.startRound();
      assert(!g.boats[7].active, "Disconnected player stays out of later races");
      g.freeze = 0; g.deadline = 1;
      g.step([]);
      assert(g.scores[0] === 3, "No checkpoint progress means no timeout award");
    },
  },
];
