import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.argv[2] || 'http://localhost:8765';
const artifacts=process.env.ARTIFACTS_DIR || '/tmp/counterstrike-3d-artifacts';
await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const errors=[];
async function page(name,viewport={width:1440,height:1050}) {
  const context=await browser.newContext({viewport}); const p=await context.newPage();
  p.on('pageerror',e=>errors.push(`${name}: ${e.message}`));
  await p.addInitScript(name=>localStorage.setItem('breach-name',name),name); return p;
}
const wait=(p,fn)=>p.waitForFunction(fn,null,{timeout:25000});
async function capture(p) {
  await p.bringToFront(); await p.locator('#scene').click();
  await wait(p,()=>document.pointerLockElement===document.getElementById('scene'));
}
async function look(p,x,y) {
  await p.evaluate(([x,y])=>document.dispatchEvent(new MouseEvent('mousemove',{movementX:x,movementY:y})),[x,y]);
}
try {
  const health=await fetch(`${base}/healthz`); assert.equal(health.status,200); assert.equal(health.headers.get('access-control-allow-origin'),'*'); assert.equal((await health.json()).ok,true);
  for (const [path,status] of [['/',200],['/ws',426],['/../etc/passwd',404],['/vendor/three.module.min.js',200]]) assert.equal((await fetch(base+path)).status,status);
  console.log('PASS server health, CORS, index, upgrade response, traversal and bundled Three.js');
  const host=await page('Viper'); await host.goto(base); await wait(host,()=>window.breach?.ws?.readyState===1);
  await host.screenshot({path:`${artifacts}/lobby-desktop.png`,fullPage:true});
  await host.goto(`${base}/?create=1`); await host.locator('#invite').waitFor({state:'visible'});
  const invite=await host.locator('#invite-link').getAttribute('href'); assert.match(invite,/\?room=[A-Z2-9]{4}$/);
  const guest=await page('Ghost'); await guest.goto(invite);
  await wait(host,()=>[...window.breach.peers.values()].some(p=>p.dc?.readyState==='open' && p.pc.connectionState==='connected'));
  await host.locator('#start').click(); await guest.locator('#buy-menu').waitFor({state:'visible'});
  assert.equal(await guest.evaluate(()=>window.breach.view.camera.isPerspectiveCamera),true);
  assert.equal(await guest.locator('#graphics-error').isVisible(),false);
  assert.ok(await host.evaluate(()=>window.breach.game.freeze>0 && window.breach.game.freeze<=450));
  // Extend only this fixture's buy period to inspect every purchase path.
  await host.evaluate(()=>window.breach.game.freeze=1800);
  assert.equal(await guest.locator('[data-item="rifle"]').isDisabled(),true);
  await guest.locator('[data-item="kit"]').click(); await wait(host,()=>window.breach.game.players[1].kit);
  assert.equal(await host.evaluate(()=>window.breach.game.players[1].money),400);
  await host.locator('[data-item="armor"]').click(); assert.equal(await host.evaluate(()=>window.breach.game.players[0].money),150);
  await guest.evaluate(()=>window.breach.peers.get(window.breach.hostId).dc.send(JSON.stringify({t:'buy',item:'rifle',pid:0})));
  await wait(guest,()=>document.getElementById('buy-feedback').textContent==='Not enough money.');
  assert.equal(await host.evaluate(()=>window.breach.game.players[0].money),150);
  await host.evaluate(()=>{for(const p of window.breach.game.players)p.money=6000;});
  await wait(guest,()=>!document.querySelector('[data-item="rifle"]').disabled);
  await guest.locator('[data-item="rifle"]').click(); await wait(host,()=>window.breach.game.players[1].weapon===2);
  await wait(guest,()=>window.breach.snapshot.p[1][9]===3300);
  await guest.locator('[data-item="armor"]').click(); await wait(host,()=>window.breach.game.players[1].armor===100);
  await host.locator('[data-item="smg"]').click(); assert.equal(await host.evaluate(()=>window.breach.game.players[0].weapon),1);
  await host.screenshot({path:`${artifacts}/buy-menu-desktop.png`,fullPage:true});
  console.log('PASS auto-create/join, WebRTC, perspective WebGL scene, host/guest purchases, money and forged purchase ownership');
  await guest.keyboard.press('b'); assert.equal(await guest.locator('#buy-menu').isVisible(),false);
  await capture(guest); await look(guest,100,-50);
  await wait(host,()=>window.breach.inputs[1][1]===194 && window.breach.inputs[1][2]===7);
  await look(guest,-100,50);
  await guest.keyboard.press('b'); await guest.locator('#buy-menu').waitFor({state:'visible'});
  assert.equal(await guest.evaluate(()=>document.pointerLockElement),null);
  await guest.keyboard.press('b'); await capture(guest);
  await host.evaluate(()=>window.breach.game.freeze=0); await wait(guest,()=>window.breach.snapshot.freeze===0);
  const before=await host.evaluate(()=>window.breach.game.players[1].x);
  await guest.keyboard.down('w'); await wait(host,()=>window.breach.inputs[1][0]===4);
  await wait(host,()=>window.breach.game.players[1].x<1100); await guest.keyboard.up('w'); await wait(host,()=>window.breach.inputs[1][0]===0);
  assert.ok((await host.evaluate(()=>window.breach.game.players[1].x))<before);
  await guest.keyboard.down('a'); await wait(host,()=>window.breach.inputs[1][0]===1);
  await guest.evaluate(()=>window.dispatchEvent(new Event('blur'))); await wait(host,()=>window.breach.inputs[1][0]===0); await guest.keyboard.up('a');
  await guest.mouse.down({button:'right'}); await wait(guest,()=>window.breach.view.camera.fov===55); await guest.mouse.up({button:'right'});
  await wait(guest,()=>window.breach.view.camera.fov===80);
  console.log('PASS pointer lock, horizontal/vertical mouse look, B releases mouse, FPS movement, blur release and aim down sights');
  await host.evaluate(()=>{const g=window.breach.game;Object.assign(g.players[0],{x:100,y:100,armor:0});Object.assign(g.players[1],{x:300,y:100});});
  await wait(guest,()=>window.breach.snapshot.p[1][0]===300);
  await guest.screenshot({path:`${artifacts}/first-person-desktop.png`,fullPage:true});
  await guest.mouse.down(); await wait(host,()=>window.breach.game.players[0].hp<100); await guest.mouse.up();
  await guest.mouse.down(); await wait(host,()=>window.breach.game.roundOver); await guest.mouse.up();
  await guest.locator('#banner').waitFor({state:'visible'}); assert.deepEqual(await host.evaluate(()=>window.breach.game.scores),[0,1]);
  assert.equal(await host.evaluate(()=>window.breach.game.players[1].money),6200);
  await host.bringToFront(); await host.keyboard.press('Space'); await wait(guest,()=>window.breach.round===2 && window.breach.snapshot?.freeze>0);
  assert.equal(await host.evaluate(()=>window.breach.game.players[1].weapon),2);
  assert.equal(await host.evaluate(()=>window.breach.game.players[0].weapon),0);
  console.log('PASS guest rifle damage and elimination, rewards, Space round advance and survivor/death equipment rules');
  await host.evaluate(()=>{const g=window.breach.game;g.freeze=0;Object.assign(g.players[0],{x:910,y:160});});
  await wait(host,()=>window.breach.snapshot.freeze===0); await capture(host);
  await host.keyboard.down('e'); await wait(guest,()=>window.breach.snapshot.b[0]===1); await host.keyboard.up('e');
  await host.evaluate(()=>{Object.assign(window.breach.game.players[1],{x:940,y:160});});
  await capture(guest); await guest.keyboard.down('e'); await wait(host,()=>window.breach.game.bomb[0]===2); await guest.keyboard.up('e');
  assert.deepEqual(await host.evaluate(()=>window.breach.game.scores),[0,2]);
  console.log('PASS first-person planting and guest kit defuse via DataChannel');
  const late=await page('Echo'); await late.goto(invite); await wait(late,()=>!!window.breach.snapshot);
  assert.match(await late.locator('#objective').innerText(),/Spectating/); await late.locator('#banner').waitFor({state:'visible'});
  await host.locator('#next').click(); await wait(late,()=>window.breach.round===3);
  await host.evaluate(()=>{const g=window.breach.game;g.freeze=0;g.scores[1]=4;g.players[0].hp=0;});
  await wait(host,()=>window.breach.game.winner(5)===1); await host.locator('#next').click();
  await wait(late,()=>window.breach.players.length===3 && !!window.breach.snapshot);
  assert.deepEqual(await host.evaluate(()=>window.breach.game.scores),[0,0]);
  assert.equal(await host.evaluate(()=>window.breach.game.players[1].money),800);
  await late.setViewportSize({width:390,height:844});
  await late.screenshot({path:`${artifacts}/buy-menu-narrow.png`,fullPage:true});
  assert.equal(await late.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await host.evaluate(()=>window.breach.game.freeze=0);
  await guest.close(); await wait(host,()=>window.breach.game.disconnected.has(1)); await wait(host,()=>window.breach.game.roundOver);
  console.log('PASS late spectating, rematch economy reset, narrow buy menu and disconnect elimination');
  const mobile=await page('Mobile',{width:390,height:844}); await mobile.goto(base);
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await mobile.screenshot({path:`${artifacts}/lobby-mobile.png`,fullPage:true});
  assert.deepEqual(errors,[]); console.log(`PASS no browser errors; screenshots: ${artifacts}`);
} catch(error) { console.error('Browser errors:',errors); throw error; }
finally {await browser.close();}
