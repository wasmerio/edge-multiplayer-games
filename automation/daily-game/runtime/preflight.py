from pathlib import Path
import urllib.error
import urllib.request

from cron import headless_check

headless_check({
    "package.json": '{"type":"module"}',
    "public/client.js": "const syntaxCheck = true;",
    "public/game.js": """
export const COLORS = ['red', 'blue'];
export const TICK_HZ = 60;
export const MAP = {baseW:800, baseH:600};
export const mapSize = () => ({w:800,h:600});
export class Game {
  constructor() {this.round=0; this.roundOver=true; this.scores=[0,0];}
  startRound() {this.round++; this.roundOver=false;}
  step() {return {p:[],d:[],over:false};}
  winner() {return -1;}
}
""",
    "test/scenarios.js": """
export const scenarios = [
  {name:'round advance', run(Game, assert) {
    const game = new Game(); game.startRound(); game.startRound();
    assert(game.round===2, 'round advance');
  }},
  {name:'round reset', run(Game, assert) {
    const game = new Game(); game.startRound();
    assert(game.roundOver===false, 'round reset');
  }}
];
""",
    "test/run.mjs": Path(__file__).with_name("run.mjs").read_text(),
})
for url in ("https://api.github.com", "https://api.openai.com"):
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            assert response.status < 500
    except urllib.error.HTTPError as error:
        assert error.code in (401, 403, 404)
        error.close()
print("PASS packaged JavaScript subprocess and outbound HTTPS")
