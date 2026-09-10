import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
async function page(games) {
  const requests = [];
  const cards = [];
  const elements = { src: {}, random: {}, games: {
    set innerHTML(value) { cards.length = 0; },
    appendChild(card) { cards.push(card); }, querySelectorAll() { return []; },
  } };
  const context = vm.createContext({
    document: { getElementById: id => elements[id], createElement: () => ({}) },
    location: {}, AbortController, setTimeout, clearTimeout, setInterval() {},
    fetch: async url => {
      requests.push(url);
      return { ok: true, json: async () => url === '/games.json' ? games : { ok: true, rooms: 1, players: 2 } };
    },
  });
  vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  return { requests, cards, elements, context };
}
const pending = { slug: 'pending', name: 'Pending', url: null };
const live = { slug: 'live', name: 'Live', url: 'https://live.wasmer.app' };
const mixed = await page([pending, live]);
assert.deepEqual(mixed.requests, ['/games.json', 'https://live.wasmer.app/healthz']);
assert.match(mixed.cards[0].innerHTML, /coming soon/);
assert.match(mixed.cards[0].innerHTML, /data-host="pending" disabled/);
assert.match(mixed.cards[1].innerHTML, /online/);
mixed.elements.random.onclick();
assert.equal(mixed.context.location.href, 'https://live.wasmer.app/?create=1');
const empty = await page([pending]);
assert.equal(empty.elements.random.disabled, true);
assert.deepEqual(empty.requests, ['/games.json']);
empty.elements.random.onclick();
assert.equal(empty.context.location.href, undefined);
console.log('PASS pending cards, health polling, and random game selection');
