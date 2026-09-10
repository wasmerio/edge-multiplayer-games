import copy
import json
import os
from pathlib import Path
import shutil
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime"))
import cron
from generator import Generator

DAY = "2026-09-10"
BASE = "a" * 40


def candidate():
    return {
        "name": "Fixture game", "description": "A fixture for the direct Edge pipeline.",
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


class FakeGitHub:
    def __init__(self):
        self.calls = []
        self.head = BASE
        self.claimed = False
        self.done = False
        self.reject_push = False
        self.generated = []

    def file(self, path, ref):
        if path.startswith("automation/daily-game/runs/"):
            return "{}" if self.done else None
        if path == cron.CATALOG:
            return json.dumps(self.generated)
        if path in cron.REFERENCE or path == ".ignore":
            return (ROOT / path).read_text()
        return None

    def request(self, path, data=None, method=None):
        self.calls.append((path, copy.deepcopy(data), method))
        if path == "/git/ref/heads/main":
            return {"object": {"sha": self.head}}
        if path == "/git/refs":
            if self.claimed:
                raise ValueError("Already claimed")
            self.claimed = True
            return {}
        if path == "/git/commits/" + BASE:
            return {"tree": {"sha": "base-tree"}}
        if path == "/git/trees":
            return {"sha": "new-tree"}
        if path == "/git/commits":
            return {"sha": "new-commit"}
        if path == "/git/refs/heads/main":
            if self.reject_push:
                raise ValueError("Branch protection rejected update")
            self.head = data["sha"]
            return {}
        raise AssertionError(path)


class FakeGenerator:
    def __init__(self, data=None):
        self.data = data or candidate()
        self.calls = []

    def generate(self, context, previous=None, failure=None):
        self.calls.append((context, previous, failure))
        return copy.deepcopy(self.data), "resp_test"


REPORT = {"ok": True, "interface": True, "scenarios": ["first", "second"]}


class PipelineTests(unittest.TestCase):
    def test_direct_generation_and_atomic_push(self):
        gh, generator = FakeGitHub(), FakeGenerator()
        self.assertEqual(cron.run(gh, generator, DAY, check=lambda files: REPORT), "new-commit")
        self.assertEqual(len(generator.calls), 1)
        self.assertFalse(any('/actions/' in path for path, _, _ in gh.calls))
        tree = next(data for path, data, _ in gh.calls if path == '/git/trees')
        files = {item['path']: item['content'] for item in tree['tree']}
        self.assertNotIn('public/games.json', files)
        self.assertEqual(files[f'daily-{DAY}/src/server.js'], (ROOT / 'achtung/src/server.js').read_text())
        prefix = (ROOT / 'achtung/public/client.js').read_text().split(cron.SPLIT)[0]
        self.assertTrue(files[f'daily-{DAY}/public/client.js'].startswith(prefix))
        self.assertIn('pending', files[f'daily-{DAY}/README.md'])
        record = json.loads(files[f'automation/daily-game/runs/{DAY}.json'])
        self.assertEqual(record['response_id'], 'resp_test')
        self.assertEqual(record['checks'], REPORT)
        app = json.loads(files[f'daily-{DAY}/app.yaml'])
        self.assertNotIn('app_id', app)
        self.assertNotIn('annotations', app)
        self.assertEqual(app['name'], f'daily-{DAY}')
        update = next(data for path, data, _ in gh.calls if path == '/git/refs/heads/main')
        self.assertFalse(update['force'])

    def test_completed_day_skips_generation(self):
        gh, generator = FakeGitHub(), FakeGenerator()
        gh.done = True
        cron.run(gh, generator, DAY)
        self.assertFalse(generator.calls)

    def test_overlapping_run_cannot_generate(self):
        gh, generator = FakeGitHub(), FakeGenerator()
        gh.claimed = True
        with self.assertRaisesRegex(ValueError, 'Already claimed'):
            cron.run(gh, generator, DAY)
        self.assertFalse(generator.calls)

    def test_main_change_prevents_push(self):
        gh = FakeGitHub()
        def check(files):
            gh.head = 'b' * 40
            return REPORT
        with self.assertRaisesRegex(ValueError, 'Main changed'):
            cron.run(gh, FakeGenerator(), DAY, check=check)
        self.assertFalse(any(path == '/git/refs/heads/main' for path, _, _ in gh.calls))

    def test_check_failure_gets_repair(self):
        gh, generator = FakeGitHub(), FakeGenerator()
        results = iter([False, True])
        def check(files):
            if not next(results):
                raise ValueError('known failing scenario')
            return REPORT
        cron.run(gh, generator, DAY, check=check)
        self.assertEqual(len(generator.calls), 2)
        self.assertEqual(generator.calls[1][2], 'known failing scenario')

    def test_three_failed_attempts_do_not_push(self):
        gh, generator = FakeGitHub(), FakeGenerator()
        def check(files):
            raise ValueError('scenario failed')
        with self.assertRaisesRegex(ValueError, 'three attempts'):
            cron.run(gh, generator, DAY, check=check)
        self.assertEqual(len(generator.calls), 3)
        self.assertEqual(gh.head, BASE)

    def test_missing_runtime_stops_without_spending_on_repairs(self):
        gh, generator = FakeGitHub(), FakeGenerator()
        def check(files):
            raise RuntimeError('runtime unavailable')
        with self.assertRaises(RuntimeError):
            cron.run(gh, generator, DAY, check=check)
        self.assertEqual(len(generator.calls), 1)
        self.assertEqual(gh.head, BASE)

    def test_branch_rejection_is_never_forced(self):
        gh = FakeGitHub()
        gh.reject_push = True
        with self.assertRaisesRegex(ValueError, 'Branch protection'):
            cron.run(gh, FakeGenerator(), DAY, check=lambda files: REPORT)
        updates = [data for path, data, _ in gh.calls if path == '/git/refs/heads/main']
        self.assertEqual(len(updates), 1)
        self.assertFalse(updates[0]['force'])

    def test_missing_dom_ids_rejected(self):
        data = candidate()
        data['index_html'] = '<a href="https://edge-multiplayer-games.wasmer.app">Games</a>'
        gh, generator = FakeGitHub(), FakeGenerator(data)
        with self.assertRaisesRegex(ValueError, 'three attempts'):
            cron.run(gh, generator, DAY, check=lambda files: self.fail('checks must not run'))
        self.assertEqual(gh.head, BASE)

    def test_real_headless_checks_and_secret_environment(self):
        node = shutil.which('node')
        self.assertIsNotNone(node)
        def check(files):
            with patch.dict(os.environ, {'GITHUB_TOKEN': 'parent-only', 'OPENAI_API_KEY': 'parent-only'}):
                return cron.headless_check(files, command=node)
        gh = FakeGitHub()
        cron.run(gh, FakeGenerator(), DAY, check=check)
        self.assertEqual(gh.head, 'new-commit')

    def test_broken_javascript_never_pushes(self):
        data = candidate()
        data['game_js'] = 'export class Game { broken syntax'
        gh = FakeGitHub()
        with self.assertRaisesRegex(ValueError, 'three attempts'):
            cron.run(gh, FakeGenerator(data), DAY,
                     check=lambda files: cron.headless_check(files, command=shutil.which('node')))
        self.assertEqual(gh.head, BASE)


class ModelTests(unittest.TestCase):
    def test_background_request_and_structured_output(self):
        calls = []
        def request(url, token, data=None):
            calls.append((url, data))
            if data:
                return {'id': 'resp_123', 'status': 'in_progress'}
            return {'id': 'resp_123', 'status': 'completed', 'output': [
                {'type': 'reasoning'}, {'type': 'message', 'content': [
                    {'type': 'output_text', 'text': json.dumps(candidate())}]}]}
        generator = Generator('test-key', 'test-model', request=request, sleep=lambda _: None)
        result, response = generator.generate({'date': DAY})
        self.assertEqual(result, candidate())
        self.assertEqual(response, 'resp_123')
        self.assertTrue(calls[0][1]['background'])
        self.assertEqual(calls[0][1]['text']['format']['type'], 'json_schema')
        self.assertTrue(calls[0][1]['input'].startswith('INPUT\n'))
        self.assertNotIn('test-key', json.dumps(calls))

    def test_incomplete_response_rejected(self):
        generator = Generator('key', 'model', request=lambda *args: {'id': 'resp_123', 'status': 'incomplete'})
        with self.assertRaisesRegex(ValueError, 'did not complete'):
            generator.generate({})

    def test_refusal_rejected(self):
        generator = Generator('key', 'model', request=lambda *args: {
            'id': 'resp_123', 'status': 'completed', 'output': [
                {'type': 'message', 'content': [{'type': 'refusal', 'refusal': 'No'}]}]})
        with self.assertRaisesRegex(ValueError, 'no source text'):
            generator.generate({})

    def test_background_timeout_cancels(self):
        now = iter([0, 0, 3000])
        calls = []
        def request(url, token, data=None):
            calls.append(url)
            return {'id': 'resp_123', 'status': 'in_progress'}
        generator = Generator('key', 'model', request=request, clock=lambda: next(now))
        with self.assertRaises(TimeoutError):
            generator.generate({})
        self.assertTrue(calls[-1].endswith('/cancel'))


if __name__ == '__main__':
    unittest.main()
