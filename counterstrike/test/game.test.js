import test from 'node:test';
import assert from 'node:assert/strict';
import {Game, RULES, WEAPONS, cleanInput, blocked} from '../public/game.js';
const game = (n=2) => { const g=new Game(n); g.startRound(); g.freeze=0; return g; };
const ticks = (g,n,inputs=[]) => { for(let i=0;i<n;i++) g.step(inputs); };
const duel = () => { const g=game(); Object.assign(g.players[0],{x:100,y:100}); Object.assign(g.players[1],{x:300,y:100}); return g; };
test('first-person movement follows yaw, normalizes diagonals, and stops at walls',()=>{
  const g=game(); g.players[0].y=100;
  ticks(g,10,[[8,0,0]]); assert.ok(Math.abs(g.players[0].x-42)<1e-8);
  ticks(g,5,[[8,0,0]]); assert.ok(g.players[0].x>=37 && g.players[0].x<42); assert.equal(blocked(g.players[0].x,100),false);
  const h=game(), p={...h.players[0]}; h.step([[6,90,0]]);
  assert.ok(Math.abs(Math.hypot(h.players[0].x-p.x,h.players[0].y-p.y)-RULES.speed)<1e-8);
  assert.ok(h.players[0].x<p.x && h.players[0].y>p.y);
});
test('pistol kills in four body hits, rewards the killer and scores once',()=>{
  const g=duel(); ticks(g,28,[[16,0,0]]);
  assert.equal(g.players[1].hp,0); assert.equal(g.players[0].ammo,8); assert.deepEqual(g.scores,[1,0]);
  assert.equal(g.players[0].kills,1); assert.equal(g.players[0].money,800+300+3250); assert.equal(g.players[1].money,800+1900);
  ticks(g,100,[[16,0,0]]); assert.deepEqual(g.scores,[1,0]); assert.equal(g.players[0].money,4350);
});
test('3D aim misses above bodies, headshots double damage, floor stops shots',()=>{
  const g=duel(); g.step([[16,0,30]]); assert.equal(g.players[1].hp,100);
  g.players[0].cooldown=0; g.step([[16,0,2]]); assert.equal(g.players[1].hp,48);
  g.players[0].cooldown=0; g.step([[16,0,-40]]); assert.equal(g.players[1].hp,48);
  assert.equal(g.events[0][6],0);
});
test('cover blocks shots in three dimensions; friendly bodies block without damage',()=>{
  const g=game(); Object.assign(g.players[0],{x:100,y:200}); Object.assign(g.players[1],{x:350,y:200});
  ticks(g,20,[[16,0,0]]); assert.equal(g.players[1].hp,100);
  const h=game(4); Object.assign(h.players[0],{x:100,y:100}); Object.assign(h.players[2],{x:180,y:100}); Object.assign(h.players[1],{x:300,y:100});
  ticks(h,20,[[16,0,0]]); assert.equal(h.players[2].hp,100); assert.equal(h.players[1].hp,100);
});
test('all weapons use their own magazine, cadence, damage, and reload duration',()=>{
  for(const [id,w] of WEAPONS.entries()) {
    const g=duel(); Object.assign(g.players[0],{weapon:id,ammo:w.magazine}); g.step([[16,0,0]]);
    assert.equal(g.players[0].ammo,w.magazine-1); assert.equal(g.players[1].hp,100-w.damage);
    ticks(g,w.cooldown-1,[[16,0,0]]); assert.equal(g.players[0].ammo,w.magazine-1);
    g.step([[32,0,0]]); assert.equal(g.players[0].reload,w.reload);
    ticks(g,w.reload-1,[[16,0,0]]); assert.equal(g.players[0].ammo,w.magazine-1);
    g.step([[16,0,0]]); assert.equal(g.players[0].ammo,w.magazine);
  }
});
test('plant needs continuous stationary input; defuse wins and pays the objective reward',()=>{
  const g=game(); Object.assign(g.players[0],{x:910,y:160});
  ticks(g,20,[[64,0,0]]); assert.equal(g.players[0].action,20);
  g.step([[65,0,0]]); assert.equal(g.players[0].action,0);
  ticks(g,RULES.plant-1,[[64,0,0]]); assert.equal(g.bomb[0],0);
  g.step([[64,0,0]]); assert.equal(g.bomb[0],1); assert.equal(g.players[0].money,1100);
  Object.assign(g.players[1],{x:g.bomb[2]+30,y:g.bomb[3]});
  ticks(g,RULES.defuse,[[],[64,180,0]]); assert.equal(g.bomb[0],2); assert.deepEqual(g.scores,[0,1]);
  assert.equal(g.players[1].money,4350);
});
test('kit halves defuse time and planted bomb survives attacker elimination',()=>{
  const g=game(); Object.assign(g.players[0],{x:910,y:160}); ticks(g,RULES.plant,[[64,0,0]]);
  Object.assign(g.players[1],{x:940,y:160,kit:true}); g.players[0].hp=0;
  ticks(g,RULES.kitDefuse-1,[[],[64,180,0]]); assert.equal(g.roundOver,false);
  g.step([[],[64,180,0]]); assert.equal(g.bomb[0],2);
  const h=game(); Object.assign(h.players[0],{x:910,y:160}); ticks(h,RULES.plant,[[64,0,0]]);
  h.players[0].hp=0; h.step(); assert.equal(h.roundOver,false);
  ticks(h,RULES.fuse); assert.equal(h.bomb[0],3); assert.deepEqual(h.scores,[1,0]);
});
test('buy period permits look but freezes movement, bullets and round timer',()=>{
  const g=new Game(2); g.startRound(); const p={...g.players[0]};
  g.step([[20,45,10]]); assert.equal(g.players[0].x,p.x); assert.equal(g.players[0].ammo,12);
  assert.equal(g.players[0].a,45); assert.equal(g.players[0].pitch,10); assert.equal(g.left,RULES.round);
  assert.equal(g.freeze,RULES.freeze-1);
});
test('purchases enforce balance, team, timer, life, spawn and item checks',()=>{
  const g=new Game(2); g.startRound();
  assert.equal(g.buy(0,'rifle').ok,false); assert.equal(g.players[0].money,800);
  assert.equal(g.buy(0,'kit').ok,false); assert.equal(g.buy(0,'armor').ok,true); assert.equal(g.players[0].money,150);
  assert.equal(g.buy(0,'armor').ok,false); assert.equal(g.players[0].money,150);
  assert.equal(g.buy(1,'kit').ok,true); assert.equal(g.players[1].money,400);
  assert.equal(g.buy(1,'unknown').ok,false); assert.equal(g.buy(15,'kit').ok,false);
  g.players[0].money=16000; g.players[0].x=500; assert.equal(g.buy(0,'rifle').ok,false);
  g.players[0].x=90; g.players[0].hp=0; assert.equal(g.buy(0,'rifle').ok,false);
  g.players[0].hp=100; g.freeze=0; assert.equal(g.buy(0,'rifle').ok,false);
  assert.equal(g.players[0].money,16000);
});
test('weapon purchase updates ammo; armor absorbs damage and loses durability',()=>{
  const g=duel(); g.freeze=10; g.players[0].money=4000;
  assert.equal(g.buy(0,'rifle').ok,true); assert.equal(g.players[0].money,1300); assert.equal(g.players[0].ammo,30);
  assert.equal(g.buy(0,'rifle').ok,false); assert.equal(g.players[0].money,1300);
  g.players[1].armor=100; g.freeze=0; g.step([[16,0,0]]);
  assert.equal(g.players[1].hp,77); assert.equal(g.players[1].armor,89);
});
test('survivors retain equipment, dead players lose it, money persists and caps at 16000',()=>{
  const g=game(); Object.assign(g.players[0],{weapon:2,armor:75,kit:false,money:6000});
  Object.assign(g.players[1],{hp:0,weapon:3,armor:100,kit:true,money:4000});
  g.startRound(); assert.equal(g.players[0].weapon,2); assert.equal(g.players[0].armor,75); assert.equal(g.players[0].ammo,30);
  assert.equal(g.players[1].weapon,0); assert.equal(g.players[1].armor,0); assert.equal(g.players[1].kit,false);
  assert.equal(g.players[1].money,4000); g.reward(0,20000); assert.equal(g.players[0].money,16000);
});
test('timeout, bomb pickup, disconnect, and match winner remain correct',()=>{
  const g=game(4); g.left=1; g.step(); assert.equal(g.result[1],'Time expired');
  g.startRound(); assert.equal(g.round,2); assert.equal(g.players[0].hp,100);
  g.freeze=0; const [,,x,y]=g.bomb; g.disconnect(0); Object.assign(g.players[2],{x,y}); g.step(); assert.equal(g.bomb[1],2);
  g.startRound(); assert.equal(g.players[0].hp,0); assert.equal(g.bomb[1],2);
  g.scores=[4,2]; assert.equal(g.winner(5),-1); g.scores[0]++; assert.equal(g.winner(5),0);
});
test('input checks bound pitch and full snapshots remain finite and compact',()=>{
  assert.deepEqual(cleanInput(null),[0,0,0]); assert.deepEqual(cleanInput([Infinity,NaN]),[0,0,0]);
  assert.deepEqual(cleanInput([255,-1,500]),[127,359,75]); assert.deepEqual(cleanInput([0,0,-500]),[0,0,-75]);
  const g=game(8), s=g.step(); assert.equal(s.p.length,8); assert.ok(JSON.stringify(s.p).length/8<100);
  for(const p of s.p) assert.ok(p.every(Number.isFinite));
  assert.equal(s.p[0].length,13); assert.equal(s.b.length,6); assert.equal(s.over,false);
});
