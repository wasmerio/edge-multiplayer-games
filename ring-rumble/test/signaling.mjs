import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2] || 'http://localhost:8765';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-background-timer-throttling']});
try {
const host=await (await browser.newContext()).newPage();
const guest=await (await browser.newContext()).newPage();
const errors=[];for(const p of [host,guest])p.on('pageerror',e=>errors.push(e.message));
await host.goto(`${base}/?create=1`);
await host.locator('#invite').waitFor({state:'visible'});
await guest.goto(await host.locator('#invite-link').getAttribute('href'));
await host.waitForFunction(()=>[...window.rumble.peers.values()].some(p=>p.dc?.readyState==='open'));
await host.locator('#start').click();
await guest.waitForFunction(()=>window.rumble.snapshot?.f===0);
await host.evaluate(()=>window.rumble.ws.close());
await guest.waitForFunction(()=>document.getElementById('status').textContent.includes('fight continues'));
await guest.evaluate(()=>window.rumble.ws.close());
await guest.keyboard.down('j');
await host.waitForFunction(()=>window.rumble.inputs[1]===16);
await guest.keyboard.up('j');
await host.waitForFunction(()=>window.rumble.inputs[1]===0);
await host.waitForFunction(()=>window.rumble.game.tick>390,null,{timeout:30000});
assert.equal(await host.evaluate(()=>window.rumble.game.disconnected.size),0);
assert.equal(await guest.locator('#game').isVisible(),true);
assert.deepEqual(errors,[]);
console.log('PASS host and guest signaling sockets closed; guest input and snapshots continue; DataChannel heartbeats keep healthy peers after 13 seconds');
}finally{await browser.close();}
