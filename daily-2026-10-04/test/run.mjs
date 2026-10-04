import { Game, COLORS, TICK_HZ, MAP, mapSize } from '../public/game.js';
import { scenarios } from './scenarios.js';

function require(condition, message) {
  if (!condition) throw new Error(message);
}
require(Array.isArray(COLORS) && COLORS.length >= 2, 'Player colors are required');
require(TICK_HZ > 0 && TICK_HZ <= 120, 'Invalid tick rate');
require(MAP && typeof mapSize === 'function', 'Map interface is required');
const game = new Game(2, mapSize(2));
require(game.round === 0 && Array.isArray(game.scores), 'Invalid initial game state');
game.startRound();
require(game.round === 1 && !game.roundOver, 'Round must start');
for (let tick = 0; tick < 120; tick++) {
  const snapshot = game.step([tick % 3 - 1, 0]);
  require(snapshot && typeof snapshot.over === 'boolean', 'Snapshot must include over');
  require(JSON.stringify(snapshot).length < 2000, 'Snapshot is too large');
}
require(typeof game.winner(10) === 'number', 'winner must return a player index or -1');
game.startRound();
require(game.round === 2, 'Round must advance');
require(Array.isArray(scenarios) && scenarios.length >= 2 && scenarios.length <= 8, 'Require two scenario checks');
const names = new Set();
for (const scenario of scenarios) {
  require(typeof scenario.name === 'string' && !names.has(scenario.name), 'Scenario names must be distinct');
  names.add(scenario.name);
  let assertions = 0;
  await scenario.run(Game, (condition, message) => {
    assertions++;
    require(condition, message || scenario.name);
  });
  require(assertions > 0, `No assertions in ${scenario.name}`);
}
console.log(JSON.stringify({ ok: true, scenarios: [...names], interface: true }));
