import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2] || 'http://localhost:8765';
const output = process.argv[3];
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try {
  const host = await browser.newPage({viewport:{width:960,height:720},deviceScaleFactor:2});
  const guest = await browser.newPage({viewport:{width:960,height:720},deviceScaleFactor:2});
  await host.goto(`${base}/?create=1`); await host.locator('#invite').waitFor({state:'visible'});
  await guest.goto(await host.locator('#invite-link').getAttribute('href'));
  await host.locator('#start').click(); await guest.locator('#buy-menu').waitFor({state:'visible'});
  await host.evaluate(()=>window.breach.game.freeze=0);
  await guest.locator('#buy-menu').waitFor({state:'hidden'});
  await guest.bringToFront(); await guest.locator('#scene').click();
  await guest.waitForFunction(()=>!!document.pointerLockElement);
  const metrics = await guest.evaluate(async()=>{
    const state=window.breach, renderer=state.view.renderer, dc=state.peers.get(state.hostId).dc;
    const samples=[], calls=[], frameTimes=[];
    let inputs=0, scoreMutations=0, buyMutations=0, frames=0, last=performance.now();
    const send=dc.send.bind(dc); dc.send=data=>{if(JSON.parse(data).t==='i')inputs++; return send(data);};
    const draw=renderer.render.bind(renderer);
    renderer.render=(...args)=>{const start=performance.now(); const result=draw(...args);samples.push(performance.now()-start);calls.push(renderer.info.render.calls);frameTimes.push(start-last);last=start;frames++;return result;};
    const scores=new MutationObserver(list=>scoreMutations+=list.length);
    const buy=new MutationObserver(list=>buyMutations+=list.length);
    scores.observe(document.getElementById('scores'),{childList:true,subtree:true});
    buy.observe(document.getElementById('buy-items'),{childList:true,subtree:true});
    for(let i=0;i<120;i++)document.dispatchEvent(new MouseEvent('mousemove',{movementX:1,movementY:0}));
    const started=performance.now();
    await new Promise(resolve=>setTimeout(resolve,2500));
    const elapsed=performance.now()-started;
    scores.disconnect();buy.disconnect();renderer.render=draw;dc.send=send;
    const average=values=>values.reduce((a,b)=>a+b,0)/values.length;
    return {inputEvents:120,inputMessages:inputs,scoreMutations,buyMutations,frames,elapsedMs:Math.round(elapsed),fps:Math.round(frames*1000/elapsed),
      drawCalls:Math.round(average(calls)),renderCpuMs:Math.round(average(samples)*100)/100,
      frameP95Ms:Math.round(frameTimes.sort((a,b)=>a-b)[Math.floor(frameTimes.length*.95)]),
      pixelRatio:renderer.getPixelRatio(),geometries:renderer.info.memory.geometries};
  });
  console.log(JSON.stringify(metrics,null,2));
  if(output)await writeFile(output,JSON.stringify(metrics,null,2)+'\n');
  if(process.env.CHECK_PERFORMANCE) {
    assert.ok(metrics.inputMessages<=3,'Mouse bursts must be coalesced');
    assert.equal(metrics.scoreMutations,0,'An unchanged scoreboard must not rebuild');
    assert.equal(metrics.buyMutations,0,'A hidden buy menu must not update');
    assert.ok(metrics.drawCalls<100,'Static geometry must be batched');
  }
} finally {await browser.close();}
