import copy
import json
import os
from pathlib import Path
import shutil
import sys
import unittest
from unittest.mock import patch

ROOT = Path(os.environ['GAME_TEST_ROOT']) if 'GAME_TEST_ROOT' in os.environ else Path(__file__).resolve().parents[3]
sys.path.insert(0, os.environ.get('GAME_RUNTIME_ROOT', str(Path(__file__).resolve().parents[1] / 'runtime')))
import game_contract as cron

DAY = "2026-09-10"
BASE = "a" * 40


def candidate():
    return {
        "name": "Fixture game", "description": "A fixture for the Pi coordinator.",
        "readme": "# Input\nDirections.\n# Snapshot\nArrays.\n# Round lifecycle\nReset the round.",
        "game_js": (ROOT / "achtung/public/game.js").read_text(),
        "client_tail": cron.SPLIT + (ROOT / "achtung/public/client.js").read_text().split(cron.SPLIT, 1)[1],
        "index_html": (ROOT / "achtung/public/index.html").read_text(),
        "style_css": (ROOT / "achtung/public/style.css").read_text(),
        "scenarios_js": """
export const scenarios = [
  {name:'wall collision awards the survivor', run(Game, assert) {
    const g = new Game(2, {w:800,h:600});
    g.startRound(); g.freeze=0;
    Object.assign(g.curves[0], {x:798,y:100,a:0,gapTimer:100});
    Object.assign(g.curves[1], {x:400,y:300,a:0,gapTimer:100});
    g.step([0,0]);
    assert(!g.curves[0].alive, 'wall death');
    assert(g.scores[1]===1, 'survivor score');
    assert(g.roundOver, 'round completion');
  }},
  {name:'winner needs an untied target score', run(Game, assert) {
    const g = new Game(2, {w:800,h:600});
    g.scores=[10,2]; assert(g.winner(10)===0, 'winner');
    g.scores=[10,10]; assert(g.winner(10)===-1, 'tie');
    assert(!process.env.OPENAI_API_KEY && !process.env.GITHUB_TOKEN, 'no inherited secrets');
  }}
];
"""}


REPORT = {"ok": True, "interface": True, "scenarios": ["first", "second"]}
