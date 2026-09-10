export const scenarios = [
  {
    name: 'Independent bays catch once and glitches floor at zero',
    run(Game, assert) {
      const g = new Game(2);
      g.startRound();
      g.freeze = 0;
      g.tick = 2;
      g.parcels = [{ id: 99, lane: 1, y: 0.875, type: 1, mask: 0 }];
      const catchFrame = g.step([0, 0]);
      assert(g.scores[0] === 1 && g.scores[1] === 1, 'Both centered players must catch the same delivery');
      assert(catchFrame.d.length === 2 && catchFrame.b[0][4] === 3, 'Catch events and resolved mask must include both players');
      g.step([0, 0]);
      assert(g.scores[0] === 1 && g.scores[1] === 1, 'Parcel may never pay twice');
      g.scores = [5, 1];
      g.carts[1].x = 0.18;
      g.parcels = [{ id: 100, lane: 1, y: 0.875, type: -1, mask: 0 }];
      const hit = g.step([0, 0]);
      assert(g.scores[0] === 3 && g.scores[1] === 1, 'Glitch subtracts two only in the aligned bay');
      assert(hit.p[0][3] < 0 && hit.d.length === 1, 'Glitch feedback and score event must render');
      g.scores[0] = 1;
      g.parcels = [{ id: 101, lane: 1, y: 0.875, type: -1, mask: 0 }];
      g.step([0, 0]);
      assert(g.scores[0] === 0, 'Glitches cannot create negative points');
    },
  },
  {
    name: 'Countdown, continuous steering, clamping and stopping',
    run(Game, assert) {
      const g = new Game(2);
      g.startRound();
      for (let k = 0; k < 45; k++) g.step([-1, 1]);
      assert(g.tick === 0 && g.carts[0].x === 0.5, 'Countdown freezes motion and deliveries');
      for (let k = 0; k < 30; k++) g.step([-1, 1]);
      assert(g.carts[0].x === 0.12 && g.carts[1].x === 0.88, 'Held directions clamp at bay walls');
      g.step([0, 0]);
      assert(g.carts[0].x === 0.12, 'Neutral intent must stop immediately');
      g.step([1, -1]);
      assert(g.carts[0].x > 0.12 && g.carts[1].x < 0.88, 'Opposite intent reverses movement');
      const x = g.carts[0].x;
      g.step([Infinity, NaN]);
      assert(g.carts[0].x === x, 'Invalid input is neutral');
    },
  },
  {
    name: 'Thirty-second shifts freeze, preserve scores and resolve ties',
    run(Game, assert) {
      const g = new Game(2);
      g.startRound();
      for (let k = 0; k < 944; k++) g.step([0, 0]);
      assert(!g.roundOver && g.tick === 899, 'Round must last all 900 active ticks');
      const end = g.step([0, 0]);
      assert(end.over && end.left === 0 && end.b.length === 0, 'Final deliveries drain before round ends');
      const stable = JSON.stringify(end);
      assert(JSON.stringify(g.step([1, -1])) === stable, 'Finished simulation is inert');
      g.scores = [20, 20];
      assert(g.winner(20) === -1, 'Tied leaders continue playing');
      g.scores[1] = 21;
      assert(g.winner(20) === 1, 'Unique target leader wins');
      g.startRound();
      assert(g.round === 2 && g.freeze === 45 && g.parcels.length === 0, 'Round state resets');
      assert(g.scores[1] === 21 && g.carts[1].x === 0.5, 'Scores persist but carts reset');
      g.disconnect(1);
      assert(g.winner(20) === 0, 'Disconnected players cannot win');
      g.startRound();
      assert(!g.carts[1].active, 'Departed players remain inactive next round');
    },
  },
  {
    name: 'Eight-player snapshots are complete and bounded',
    run(Game, assert) {
      const g = new Game(8);
      g.startRound();
      let largest = 0;
      for (let k = 0; k < 945; k++) {
        const s = JSON.parse(JSON.stringify(g.step(Array(8).fill(0))));
        largest = Math.max(largest, JSON.stringify(s).length);
        assert(s.p.length === 8 && s.p.every((p) => p.length === 4), 'All carts are renderable from one frame');
        assert(s.b.every((b) => b.length === 5) && s.b.length <= 3, 'Shared delivery list stays bounded');
      }
      assert(largest < 800, 'Snapshot must average less than 100 bytes per player');
      assert(g.roundOver, 'Full population finishes normally');
    },
  },
];
