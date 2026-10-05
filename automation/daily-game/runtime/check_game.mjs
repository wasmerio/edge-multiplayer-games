// Engine gate for one generated game: node check_game.mjs <repository> <slug>
// Prints a one-line JSON report, or one named rejection on stderr with exit 1.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TICKS = 600;
const FIXTURE = 'test/replay.ndjson';

class Rejection extends Error {}
const reject = (reason, detail) => { throw new Rejection(`${reason}: ${detail}`); };
const text = (error) => String(error?.message ?? error).replace(/\s+/g, ' ').trim();

// Cycles every field through neutral, min and max so the snapshot sees real motion.
function intentsAt(intent, players, tick) {
  return Array.from({ length: players }, (_, seat) => Object.fromEntries(
    Object.entries(intent).map(([name, spec]) => {
      const values = spec.values ?? [spec.neutral ?? 0, spec.min ?? -1, spec.max ?? 1];
      return [name, values[(Math.floor(tick / 15) + seat) % values.length]];
    })));
}

export async function checkGame(repository, slug) {
  const load = (file) => import(pathToFileURL(path.join(repository, file)).href);
  const engine = await load('engine/engine.js');
  const { ENGINE_VERSION, MAX_PLAYERS_PER_ROOM, SNAPSHOT_BUDGET_BYTES } = engine.params;
  const published = path.join(repository, 'public/engine', ENGINE_VERSION);
  if (!fs.existsSync(path.join(published, 'engine.js'))) {
    reject('Engine version is not published', `${ENGINE_VERSION} has no public/engine/${ENGINE_VERSION}/engine.js`);
  }

  const game = await load(`${slug}/public/game.js`).catch((error) => reject('Simulation module does not load', text(error)));
  const Simulation = game.Simulation ?? game.Game;
  if (typeof Simulation !== 'function') reject('Simulation rejected', 'public/game.js must export the class as Game or Simulation');
  if (!game.SNAPSHOT || !game.INTENT) reject('Simulation rejected', 'public/game.js must export SNAPSHOT and INTENT');
  // Built exactly as the host builds it: the game's ARENA, else the engine's default.
  const arena = typeof game.ARENA === 'function' ? game.ARENA : game.ARENA ? () => game.ARENA : engine.arenaFor;
  const build = (players, opts, rng) => new Simulation(players, { ...opts, arena: arena(players) }, rng);
  try { engine.validateSimulation(Simulation, { arena: arena(2) }); }
  catch (error) { reject('Simulation rejected', text(error)); }

  let schema;
  try { schema = engine.defineSnapshot(game.SNAPSHOT); }
  catch (error) { reject('Snapshot schema does not compile', text(error)); }
  if (schema.budgetBytes > SNAPSHOT_BUDGET_BYTES) {
    reject('Snapshot exceeds its budget', `schema raises budgetBytes to ${schema.budgetBytes}, above SNAPSHOT_BUDGET_BYTES (${SNAPSHOT_BUDGET_BYTES} bytes per player per tick)`);
  }

  let largest = 0;
  for (const players of [2, MAX_PLAYERS_PER_ROOM]) {
    const sim = build(players, {}, engine.seededRng(players));
    for (let tick = 0; tick < TICKS; tick++) {
      let snapshot;
      try {
        if (sim.roundOver) sim.startRound();
        // The host sends 0 for a seat that has not spoken yet.
        snapshot = sim.step(Object.freeze(tick === 0 ? new Array(players).fill(0) : intentsAt(game.INTENT, players, tick)));
      } catch (error) { reject('Simulation rejected', `step() threw with ${players} players at tick ${tick}: ${text(error)}`); }
      let bytes;
      try { bytes = schema.encode(snapshot, players).byteLength; }
      catch (error) {
        const reason = /SNAPSHOT_BUDGET_BYTES/.test(text(error)) ? 'Snapshot exceeds its budget' : 'Snapshot does not encode';
        reject(reason, `${text(error)} (${SNAPSHOT_BUDGET_BYTES} bytes per player per tick, tick ${tick})`);
      }
      if (bytes > SNAPSHOT_BUDGET_BYTES * players) {
        reject('Snapshot exceeds its budget', `${bytes} bytes for ${players} players at tick ${tick}, above SNAPSHOT_BUDGET_BYTES (${SNAPSHOT_BUDGET_BYTES} bytes per player per tick)`);
      }
      largest = Math.max(largest, Math.ceil(bytes / players));
    }
  }

  const file = path.join(repository, slug, FIXTURE);
  if (!fs.existsSync(file)) reject('Fixture does not replay', `${FIXTURE} is missing; record one with the engine's record()`);
  let fixture;
  let reached;
  try {
    const recorded = fs.readFileSync(file, 'utf8');
    fixture = engine.parseFixture(recorded);
    reached = engine.replay(recorded, build);
  } catch (error) { reject('Fixture does not replay', text(error)); }
  if (!fixture.header.final) reject('Fixture does not replay', `${FIXTURE} records no final state`);
  if (reached.round < 1 || fixture.events.length < 60) {
    reject('Fixture does not replay', `${FIXTURE} holds ${fixture.events.length} events over ${reached.round} rounds; record at least one round of 60 ticks`);
  }

  return {
    ok: true, engine: ENGINE_VERSION, simulation: Simulation.name, schema: schema.hash,
    snapshot: { bytesPerPlayer: largest, budget: SNAPSHOT_BUDGET_BYTES },
    fixture: { events: fixture.events.length, players: fixture.header.players, final: reached },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [repository, slug] = process.argv.slice(2);
  if (!repository || !slug || repository === '--help') {
    console.log('usage: node check_game.mjs <repository> <slug>');
    process.exitCode = repository === '--help' ? 0 : 1;
  } else {
    try {
      console.log(JSON.stringify(await checkGame(path.resolve(repository), slug)));
    } catch (error) {
      console.error(error instanceof Rejection ? error.message : `Game check crashed: ${text(error)}`);
      process.exitCode = 1;
    }
  }
}
