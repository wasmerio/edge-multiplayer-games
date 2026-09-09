import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, botInput, mapSize } from '../public/game.js';
const ready = (n = 2) => { const g = new Game(n); g.startRound(); g.freeze = 0; return g; };
const lineUp = g => {
  Object.assign(g.fighters[0], { x: 0, z: 0, a: Math.PI / 2 });
  Object.assign(g.fighters[1], { x: 1.2, z: 0, a: -Math.PI / 2 });
};

test('countdown freezes combat and movement', () => {
  const g = new Game(2); const first = g.startRound();
  for (let i = 0; i < 60; i++) assert.deepEqual(g.step([18, 0]).p, first.p);
  assert.equal(g.freeze, 0); assert.equal(g.tick, 0);
  g.step([2, 0]); assert.equal(g.tick, 1);
});

test('straight movement falls at the predictable edge tick and scores once', () => {
  const g = ready(); const x = g.fighters[0].x;
  const expected = Math.floor((g.radius + 0.15 + x) / 0.115) + 1;
  let s;
  for (let i = 1; i <= expected; i++) {
    s = g.step([1, 0]); assert.equal(s.over, i === expected);
  }
  assert.deepEqual(s.d, [0]); assert.equal(s.win, 1);
  assert.deepEqual(g.scores, [0, 1]);
  for (let i = 0; i < 10; i++) g.step([1, 0]);
  assert.deepEqual(g.scores, [0, 1]);
});

test('diagonal speed equals straight speed and opposite directions cancel', () => {
  const a = ready(), b = ready(); const p = { ...a.fighters[0] };
  a.step([2, 0]); b.step([10, 0]);
  assert.ok(Math.abs(Math.hypot(a.fighters[0].x-p.x,a.fighters[0].z-p.z)-Math.hypot(b.fighters[0].x-p.x,b.fighters[0].z-p.z))<1e-9);
  const c = ready(); const before = c.snapshot().p[0]; c.step([15, 0]);
  assert.deepEqual(c.snapshot().p[0], before);
});

test('punch hits once after windup, adds damage, and pushes opponent away', () => {
  const g = ready(); lineUp(g);
  for (let i = 0; i < 3; i++) assert.equal(g.step([16, 0]).e.length, 0);
  const hit = g.step([16, 0]); assert.deepEqual(hit.e, [[0, 1]]);
  assert.equal(g.fighters[1].damage, 18); assert.ok(g.fighters[1].vx > 0);
  g.step([16, 0]); assert.ok(g.fighters[1].x > 1.2);
  for (let i = 0; i < 8; i++) assert.equal(g.step([16, 0]).e.length, 0);
});

test('dash avoids a punch, cannot repeat while held, and rearms after release', () => {
  const g = ready(); lineUp(g);
  for (let i = 0; i < 3; i++) g.step([16, 0]);
  const snap = g.step([16, 32]); assert.equal(snap.e.length, 0); assert.equal(g.fighters[1].damage, 0);
  const a = ready(); Object.assign(a.fighters[0], { x: 0, z: 0, a: 0 });
  a.step([32, 0]); assert.equal(a.fighters[0].dash, 7);
  for (let i = 0; i < 45; i++) a.step([32, 0]);
  assert.equal(a.fighters[0].dash, 0); assert.equal(a.fighters[0].cooldown, 0);
  a.step([0,0]); a.step([32,0]); assert.equal(a.fighters[0].dash, 7);
});

test('simultaneous punches trade without player-order advantage', () => {
  const g = ready(); lineUp(g); let s;
  for (let i = 0; i < 4; i++) s = g.step([16, 16]);
  assert.deepEqual(s.e, [[0, 1], [1, 0]]);
  assert.equal(g.fighters[0].damage, g.fighters[1].damage);
  assert.ok(g.fighters[0].vx < 0); assert.ok(g.fighters[1].vx > 0);
});

test('double ring-out draws and reset keeps only match scores', () => {
  const g = ready(); g.scores = [2, 3];
  g.fighters.forEach(p => { p.x = 20; p.damage = 90; });
  const s = g.step([0,0]); assert.equal(s.over, true); assert.equal(s.win, -1);
  assert.deepEqual(s.d, [0,1]); assert.deepEqual(g.scores, [2,3]);
  g.startRound(); assert.equal(g.round, 2); assert.equal(g.freeze,60);
  assert.equal(g.roundOver, false); assert.equal(g.radius, g.baseRadius);
  assert.ok(g.fighters.every(p => p.alive && p.damage === 0 && p.cooldown === 0));
});

test('disconnect removes fighter for this match and awards survivor', () => {
  const g = ready(); g.disconnect(1); const s = g.step([0,0]);
  assert.deepEqual(s.d,[1]); assert.equal(s.win,0);
  g.startRound(); assert.equal(g.fighters[1].alive,false);
});

test('arena shrinks and round time limit resolves a draw', () => {
  const g = ready(); lineUp(g); g.tick=600;
  g.step([0,0]); assert.ok(g.radius < g.baseRadius);
  g.tick=1799; const s=g.step([0,0]); assert.equal(s.over,true); assert.equal(s.win,-1);
});

test('fixed replay is deterministic and snapshots fit the bandwidth budget', () => {
  const run = () => { const g=ready(8); let max=0;
    for(let i=0;i<2200 && !g.roundOver;i++) {
      const snap=g.step(g.fighters.map((_,j)=>botInput(g,j)));
      max=Math.max(max,Buffer.byteLength(JSON.stringify(snap.p))/8);
      assert.deepEqual(JSON.parse(JSON.stringify(snap)),snap);
    }
    assert.ok(max<100); assert.ok(g.roundOver); return g.snapshot();
  };
  assert.deepEqual(run(),run());
  assert.throws(()=>new Game(9),RangeError);
  assert.equal(mapSize(8).radius,8.5);
});

test('five wins ends the match', () => {
  const g=ready();
  for(let i=0;i<5;i++) { g.freeze=0; g.fighters[1].x=30; g.step([0,0]); if(i<4)g.startRound(); }
  assert.equal(g.winner(5),0); assert.deepEqual(g.scores,[5,0]);
});
