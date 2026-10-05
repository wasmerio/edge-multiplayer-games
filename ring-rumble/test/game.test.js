import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, botInput, mapSize, maskOf, hitPairs, SNAPSHOT, INTENT, BINDINGS } from '../public/game.js';
import { validateSimulation } from '../../engine/sim.js';
import { defineSnapshot } from '../../engine/schema.js';
import { seededRng } from '../../engine/rng.js';
import { record, replay } from '../../engine/replay.js';
import { inputSource } from '../../engine/input.js';

const schema = defineSnapshot(SNAPSHOT);
// The per-fighter row the scenarios were written against, read from the declared fields.
const rows = s => s.x.map((_, i) => [s.x[i], s.z[i], s.a[i], s.dmg[i], +s.alive[i], s.atk[i], s.dash[i], s.cd[i], s.stun[i]]);
const ready = (n = 2) => { const g = new Game(n); g.startRound(); g.freeze = 0; return g; };
const lineUp = g => {
  Object.assign(g.fighters[0], { x: 0, z: 0, a: Math.PI / 2 });
  Object.assign(g.fighters[1], { x: 1.2, z: 0, a: -Math.PI / 2 });
};

test('countdown freezes combat and movement', () => {
  const g = new Game(2); const first = g.startRound();
  for (let i = 0; i < 60; i++) assert.deepEqual(rows(g.step([18, 0])), rows(first));
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
  const c = ready(); const before = rows(c.snapshot())[0]; c.step([15, 0]);
  assert.deepEqual(rows(c.snapshot())[0], before);
});

test('punch hits once after windup, adds damage, and pushes opponent away', () => {
  const g = ready(); lineUp(g);
  for (let i = 0; i < 3; i++) assert.equal(hitPairs(g.step([16, 0])).length, 0);
  const hit = g.step([16, 0]); assert.deepEqual(hitPairs(hit), [[0, 1]]);
  assert.equal(g.fighters[1].damage, 18); assert.ok(g.fighters[1].vx > 0);
  g.step([16, 0]); assert.ok(g.fighters[1].x > 1.2);
  for (let i = 0; i < 8; i++) assert.equal(hitPairs(g.step([16, 0])).length, 0);
});

test('dash avoids a punch, cannot repeat while held, and rearms after release', () => {
  const g = ready(); lineUp(g);
  for (let i = 0; i < 3; i++) g.step([16, 0]);
  const snap = g.step([16, 32]); assert.equal(hitPairs(snap).length, 0); assert.equal(g.fighters[1].damage, 0);
  const a = ready(); Object.assign(a.fighters[0], { x: 0, z: 0, a: 0 });
  a.step([32, 0]); assert.equal(a.fighters[0].dash, 7);
  for (let i = 0; i < 45; i++) a.step([32, 0]);
  assert.equal(a.fighters[0].dash, 0); assert.equal(a.fighters[0].cooldown, 0);
  a.step([0,0]); a.step([32,0]); assert.equal(a.fighters[0].dash, 7);
});

test('simultaneous punches trade without player-order advantage', () => {
  const g = ready(); lineUp(g); let s;
  for (let i = 0; i < 4; i++) s = g.step([16, 16]);
  assert.deepEqual(hitPairs(s), [[0, 1], [1, 0]]);
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
      max=Math.max(max,schema.encode(snap,8).byteLength/8);
      assert.deepEqual(JSON.parse(JSON.stringify(snap)),snap);
    }
    assert.ok(max<=schema.budgetBytes); assert.ok(g.roundOver); return g.snapshot();
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

test('the simulation satisfies the engine shape', () => {
  assert.equal(validateSimulation(Game, { arena: { w: 960, h: 600, ...mapSize(2) } }), true);
  assert.equal(new Game(8, { arena: mapSize(8) }, seededRng(1)).baseRadius, 8.5);
});

test('an intent object and its bitmask drive the same fight', () => {
  assert.equal(maskOf({ x: -1, z: 1, punch: 1, dash: 0 }), 1 | 8 | 16);
  assert.equal(maskOf({ x: 1, z: -1, punch: 0, dash: 1 }), 2 | 4 | 32);
  assert.equal(maskOf(0), 0); assert.equal(maskOf(undefined), 0); assert.equal(maskOf(255), 63);
  const a = ready(), b = ready();
  for (let i = 0; i < 40; i++) { a.step([{ x: 1, z: 0, punch: 1, dash: 0 }, 0]); b.step([2 | 16, 0]); }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('the bindings keep the keyboard layout and feed only declared intent', () => {
  assert.deepEqual(Object.keys(INTENT), ['x', 'z', 'punch', 'dash']);
  const listeners = {}, sent = [];
  const target = { addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {} };
  inputSource({ intent: INTENT, bindings: BINDINGS, onChange: v => sent.push(maskOf(v)), deps: { target, gamepads: () => [], hasTouch: () => false } });
  const press = code => listeners.keydown({ code, preventDefault() {} }), release = code => listeners.keyup({ code });
  for (const [code, bit] of [['ArrowLeft', 1], ['KeyA', 1], ['ArrowRight', 2], ['KeyD', 2], ['ArrowUp', 4], ['KeyW', 4], ['ArrowDown', 8], ['KeyS', 8], ['KeyJ', 16], ['KeyK', 32], ['ShiftLeft', 32], ['ShiftRight', 32]]) {
    press(code); assert.equal(sent.at(-1), bit, code); release(code); assert.equal(sent.at(-1), 0, code);
  }
  press('KeyA'); press('KeyD'); assert.equal(sent.at(-1), 0, 'opposite directions cancel');
  listeners.blur(); assert.equal(sent.at(-1), 0);
});

test('a snapshot fits its budget at the player cap and round-trips through the codec', () => {
  const g = ready(8); let snap, worst = 0;
  for (let i = 0; i < 400; i++) {
    snap = g.step(g.fighters.map((_, j) => botInput(g, j)));
    worst = Math.max(worst, schema.encode(snap, 8).byteLength);
  }
  assert.ok(worst <= schema.budgetBytes * 8, `${worst} bytes`);
  assert.ok(worst / 8 < 20, `${worst / 8} bytes per player`);
  assert.deepEqual(schema.decode(schema.encode(snap, 8), 8), snap);
});

test('the countdown keeps the stream ordered while the game tick stands still', () => {
  const g = new Game(2); g.startRound();
  const a = g.step([0, 0]), b = g.step([0, 0]);
  assert.equal(a.k, 0); assert.equal(b.k, 0); assert.equal(b.n, a.n + 1); assert.equal(schema.tickField, 'n');
});

const build = (n, opts, rng) => new Game(n, opts, rng);

test('the committed fixture replays to its recorded state', () => {
  const fixture = fs.readFileSync(new URL('./replay.ndjson', import.meta.url), 'utf8');
  const reached = replay(fixture, build);
  assert.ok(reached.round >= 3, `played ${reached.round} rounds`);
  assert.ok(reached.scores.reduce((a, b) => a + b, 0) >= 1);
});

test('two runs from one seed reach the same state', () => {
  const play = () => {
    const g = build(4, {}, seededRng(77)), rec = record({ seed: 77, tickHz: 30, players: 4 });
    for (let r = 0; r < 2; r++) {
      rec.round(); g.startRound();
      for (let i = 0; i < 400 && !g.roundOver; i++) { const inputs = g.fighters.map((_, j) => botInput(g, j)); rec.tick(inputs); g.step(inputs); }
    }
    return rec.finish(g);
  };
  assert.equal(play(), play());
});
