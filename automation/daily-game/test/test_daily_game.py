import argparse
import contextlib
import io
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

from fixtures import ROOT, DAY, BASE, REPORT, candidate
import daily_game as job


class FakeGitHub:
    root = "https://api.github.com/repos/wasmerio/edge-multiplayer-games"

    def __init__(self):
        self.pull = None
        self.has_branch = False
        self.calls = []
        self.fail_create = False

    def request(self, path, data=None, method=None):
        self.calls.append((path, data))
        if path.startswith('/pulls?'):
            return [self.pull] if self.pull else []
        if path.startswith('/git/ref/heads/'):
            if not self.has_branch:
                raise urllib.error.HTTPError('https://api.github.com', 404, 'missing', {}, None)
            return {'object': {'sha': 'b' * 40}}
        if path == '/pulls':
            if self.fail_create:
                raise urllib.error.HTTPError('https://api.github.com', 503, 'retry', {}, None)
            self.pull = {'html_url': 'https://github.com/wasmerio/edge-multiplayer-games/pull/123'}
            return self.pull
        raise AssertionError(path)


class FakeCommands:
    """Simulate Git only; game checks still execute in real Node."""
    def __init__(self, gh):
        self.gh = gh
        self.calls = []
        self.published = None
        self.reject_push = False
        self.base = {p: (ROOT / p).read_text() for p in (*job.REFERENCE, '.wasmerignore')}
        self.node = shutil.which('node')

    def files(self):
        return {str(p.relative_to(self.work)): p.read_text() for p in self.work.rglob('*')
                if p.is_file() and '.git' not in p.relative_to(self.work).parts}

    def __call__(self, args, cwd, env, timeout=60, strip=True):
        if args[0] == '/bin/node':
            if args[1].endswith('/capture.mjs') and not os.environ.get('WASMER_GIT_TESTS'):
                args = args[4:]
            previous = os.getcwd()
            try:
                os.chdir(cwd)
                result = subprocess.run([self.node if arg == '/bin/node' else arg for arg in args], env=env,
                                        capture_output=True, text=True, timeout=30)
            finally:
                os.chdir(previous)
            if result.returncode:
                raise RuntimeError(result.stderr)
            return result.stdout.strip()
        words = args[3:]
        self.calls.append((words, dict(env)))
        cmd = words[0]
        if cmd == 'clone':
            self.work = Path(words[-1])
            self.work.mkdir()
            self.head = 'b' * 40 if self.gh.has_branch else BASE
            for name, text in (self.published if self.gh.has_branch else self.base).items():
                p = self.work / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(text)
            (self.work / '.git').mkdir()
            (self.work / '.git/config').write_text('[core]\n')
        elif cmd == 'rev-parse':
            return self.head
        elif cmd == 'show':
            return self.base[words[1].split(':', 1)[1]]
        elif cmd == 'ls-tree':
            return ''
        elif cmd == 'diff':
            if '--binary' in words:
                return json.dumps(self.files())
            if self.gh.has_branch or '--cached' in words:
                return '\n'.join(p for p, text in self.files().items() if self.base.get(p) != text)
            return '\n'.join(p for p, text in self.base.items() if self.files().get(p) != text)
        elif cmd == 'ls-files':
            if '--stage' in words:
                result = []
                for name in words[words.index('--') + 1:]:
                    content = (self.work / name).read_bytes()
                    oid = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
                    result.append('100644 ' + oid + ' 0\t' + name + '\0')
                return ''.join(result)
            return '\n'.join(set(self.files()) - set(self.base))
        elif cmd == 'apply':
            for name, text in json.loads(Path(words[-1]).read_text()).items():
                p = self.work / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(text)
        elif cmd == 'commit':
            self.head = 'b' * 40
        elif cmd == 'push':
            if self.reject_push:
                raise RuntimeError('non-fast-forward')
            self.published = self.files()
            self.gh.has_branch = True
        elif cmd not in {'switch', 'add', 'fetch', 'status', 'read-tree'}:
            raise AssertionError(words)
        return ''


class DailyGameTests(unittest.TestCase):
    def setUp(self):
        self.gh = FakeGitHub()
        self.commands = FakeCommands(self.gh)
        self.agent_env = None
        self.args = argparse.Namespace(date=DAY, repository='wasmerio/edge-multiplayer-games',
                                       publish=True, output=None, model='fixture')

    def agent(self, work, env, system, prompt, model):
        self.agent_env = env
        self.agent_input = json.loads(prompt.removeprefix('INPUT\n'))
        c = candidate()
        game = work / ('daily-' + DAY)
        (game / 'README.md').write_text(c['readme'])
        (game / 'test/scenarios.js').write_text(c['scenarios_js'])
        (game / 'game-entry.json').write_text(json.dumps({'name': c['name'], 'description': c['description']}))
        return {'ok': True, 'bashCalls': 1}

    def invoke(self, agent=None):
        with patch.dict(os.environ, {'GH_TOKEN': 'fixture-gh', 'OPENAI_API_KEY': 'fixture-model'}), \
             patch.object(job, 'GitHub', return_value=self.gh), \
             patch.object(job, 'execute', side_effect=self.commands), \
             patch.object(job, 'run_pi', side_effect=agent or self.agent), \
             contextlib.redirect_stdout(io.StringIO()):
            job.run(self.args)

    def test_branch_push_draft_pr_and_credential_separation(self):
        self.invoke()
        push, env = next((a, e) for a, e in self.commands.calls if a[0] == 'push')
        self.assertEqual(push, ['push', 'origin', 'HEAD:refs/heads/daily-game/' + DAY])
        self.assertNotIn('GH_TOKEN', self.agent_env)
        self.assertNotIn('GIT_CONFIG_VALUE_0', self.agent_env)
        self.assertNotIn('OPENAI_API_KEY', env)
        self.assertIn('Authorization: Basic ', env['GIT_CONFIG_VALUE_0'])
        body = next(data for path, data in self.gh.calls if path == '/pulls')
        self.assertTrue(body['draft'])
        self.assertEqual(body['base'], 'main')
        self.assertIn('remain pending', body['body'])

    def test_existing_pr_skips_generation(self):
        self.gh.pull = {'html_url': 'https://github.com/example/repo/pull/1'}
        self.invoke(agent=lambda *args: self.fail('Pi should not run'))
        self.assertFalse(self.commands.calls)

    def test_persistent_run_retains_checkout_patch_and_pr(self):
        with tempfile.TemporaryDirectory() as root:
            self.args.work_root = root
            self.invoke()
            attempt, = Path(root).iterdir()
            self.assertTrue((attempt / 'repository' / ('daily-' + DAY) / 'public/game.js').is_file())
            self.assertTrue((attempt / 'artifacts' / ('daily-' + DAY + '.patch')).is_file())
            self.assertEqual(json.loads((attempt / 'pr.json').read_text())['url'], self.gh.pull['html_url'])
            self.assertEqual(json.loads((attempt / 'status.json').read_text())['status'], 'completed')
            self.assertEqual(Path(self.agent_env['TMPDIR']), attempt)
            self.assertTrue(Path(self.agent_env['HOME']).is_relative_to(attempt))

    def test_persistent_run_retains_failed_agent_edits(self):
        with tempfile.TemporaryDirectory() as root:
            self.args.work_root = root
            def fail(work, *args):
                (work / ('daily-' + DAY) / 'public/game.js').write_text('partial candidate')
                raise RuntimeError('Pi stopped')
            with self.assertRaisesRegex(RuntimeError, 'Pi stopped'):
                self.invoke(agent=fail)
            attempt, = Path(root).iterdir()
            self.assertEqual((attempt / 'repository' / ('daily-' + DAY) / 'public/game.js').read_text(), 'partial candidate')
            self.assertEqual(json.loads((attempt / 'status.json').read_text())['status'], 'failed')
            self.assertFalse(any(args[0] == 'push' for args, env in self.commands.calls))

    def test_prompt_injects_guide_and_pr_registers_root_catalog(self):
        self.invoke()
        self.assertEqual(self.agent_input['repository_instructions'], (ROOT / 'AGENTS.md').read_text())
        self.assertEqual(self.agent_input['registration_contract']['catalog'], 'public/games.json')
        self.assertEqual(self.agent_input['registration_contract']['upload_filter'], '.wasmerignore')
        self.assertNotIn('.ignore', self.commands.published)
        original = json.loads(self.commands.base['public/games.json'])
        published = json.loads(self.commands.published['public/games.json'])
        self.assertEqual(published[:-1], original)
        self.assertEqual(published[-1], {
            'slug': 'daily-' + DAY, 'name': candidate()['name'],
            'description': candidate()['description'], 'players': '2 to 8',
            'source': 'daily-' + DAY + '/', 'url': None,
        })
        self.assertIn('/daily-' + DAY + '/\n', self.commands.published['.wasmerignore'])

    def test_saved_preview_rejects_root_catalog_replacement(self):
        with tempfile.TemporaryDirectory() as output:
            self.args.publish = False
            self.args.output = output
            self.invoke()
            patchfile = Path(output) / ('daily-' + DAY + '.patch')
            files = json.loads(patchfile.read_text())
            files['public/games.json'] = '[]\n'
            patchfile.write_text(json.dumps(files))
            self.args.publish = True
            self.args.from_preview = output
            with self.assertRaisesRegex(ValueError, 'Saved root catalog differs'):
                self.invoke(agent=lambda *args: self.fail('Must not regenerate'))
            self.assertFalse(any(a[0] == 'push' for a, _ in self.commands.calls))

    def test_failed_checks_never_push(self):
        with patch.object(job, 'check_game', side_effect=ValueError('bad game')):
            with self.assertRaisesRegex(ValueError, 'bad game'):
                self.invoke()
        self.assertFalse(any(a[0] == 'push' for a, _ in self.commands.calls))
        self.assertFalse(any(p == '/pulls' for p, _ in self.gh.calls))

    def test_checks_cannot_rewrite_checked_source(self):
        original = job.check_game
        def mutate(work, slug, env):
            result = original(work, slug, env)
            (work / slug / 'public/client.js').write_text('unchecked replacement')
            return result
        with patch.object(job, 'check_game', side_effect=mutate):
            with self.assertRaisesRegex(ValueError, 'Game checks changed repository files'):
                self.invoke()
        self.assertFalse(any(a[0] == 'push' for a, _ in self.commands.calls))

    def test_checks_cannot_delete_protected_files(self):
        def mutate(work, slug, env):
            (work / 'AGENTS.md').unlink()
            return REPORT
        with patch.object(job, 'check_game', side_effect=mutate):
            with self.assertRaisesRegex(ValueError, 'Game checks changed repository files'):
                self.invoke()
        self.assertFalse(any(a[0] == 'push' for a, _ in self.commands.calls))

    def test_protected_repo_edit_never_pushes(self):
        def rogue(*args):
            self.agent(*args)
            (args[0] / 'AGENTS.md').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'Unexpected changed paths'):
            self.invoke(agent=rogue)
        self.assertFalse(any(a[0] == 'push' for a, _ in self.commands.calls))

    def test_recovers_pr_after_successful_push(self):
        self.gh.fail_create = True
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.invoke()
        caught.exception.close()
        self.gh.fail_create = False
        self.invoke(agent=lambda *args: self.fail('Recovery must not regenerate'))
        self.assertIsNotNone(self.gh.pull)
        self.assertEqual(sum(a[0] == 'push' for a, _ in self.commands.calls), 1)

    def test_preview_exports_without_remote_write(self):
        self.args.publish = False
        with tempfile.TemporaryDirectory() as output:
            self.args.output = output
            self.invoke()
            self.assertTrue((Path(output) / ('daily-' + DAY + '.patch')).is_file())
            self.assertEqual(json.loads((Path(output) / ('daily-' + DAY + '.json')).read_text())['checks']['ok'], True)
        self.assertFalse(any(a[0] in {'push', 'commit'} for a, _ in self.commands.calls))
        self.assertFalse(self.gh.calls)

    def test_missing_page_contract_never_pushes(self):
        def broken(*args):
            self.agent(*args)
            (args[0] / ('daily-' + DAY) / 'public/index.html').write_text('<html></html>')
        with self.assertRaisesRegex(ValueError, 'Missing client element IDs'):
            self.invoke(agent=broken)
        self.assertFalse(any(a[0] == 'push' for a, _ in self.commands.calls))

    def test_publishes_saved_preview_without_model(self):
        with tempfile.TemporaryDirectory() as output:
            self.args.publish = False
            self.args.output = output
            self.invoke()
            self.args.publish = True
            self.args.from_preview = output
            with patch.dict(os.environ, {'GH_TOKEN': 'fixture-gh'}, clear=True), \
                 patch.object(job, 'GitHub', return_value=self.gh), \
                 patch.object(job, 'execute', side_effect=self.commands), \
                 patch.object(job, 'run_pi', side_effect=AssertionError('Must reuse Pi output')), \
                 contextlib.redirect_stdout(io.StringIO()):
                job.run(self.args)
            self.assertIsNotNone(self.gh.pull)

    def test_saved_preview_rejects_protected_changes(self):
        with tempfile.TemporaryDirectory() as output:
            self.args.publish = False
            self.args.output = output
            self.invoke()
            patchfile = Path(output) / ('daily-' + DAY + '.patch')
            files = json.loads(patchfile.read_text())
            files['AGENTS.md'] = 'unexpected change'
            patchfile.write_text(json.dumps(files))
            self.args.publish = True
            self.args.from_preview = output
            with self.assertRaisesRegex(ValueError, 'Unexpected changed paths'):
                self.invoke(agent=lambda *args: self.fail('Must not regenerate'))
            self.assertFalse(any(a[0] == 'push' for a, _ in self.commands.calls))

    def test_replays_preview_with_legacy_upload_filter(self):
        with tempfile.TemporaryDirectory() as output:
            self.args.publish = False
            self.args.output = output
            self.invoke()
            patchfile = Path(output) / ('daily-' + DAY + '.patch')
            reportfile = Path(output) / ('daily-' + DAY + '.json')
            files = json.loads(patchfile.read_text())
            report = json.loads(reportfile.read_text())
            del report['upload_filter']
            files['automation/daily-game/runs/' + DAY + '.json'] = json.dumps(report)
            files['.ignore'] = files.pop('.wasmerignore')
            self.commands.base['.ignore'] = self.commands.base.pop('.wasmerignore')
            patchfile.write_text(json.dumps(files))
            reportfile.write_text(json.dumps(report))
            self.args.publish = True
            self.args.from_preview = output
            self.invoke(agent=lambda *args: self.fail('Must reuse the saved game'))
            self.assertIsNotNone(self.gh.pull)

    def test_broken_simulation_never_pushes(self):
        def broken(*args):
            self.agent(*args)
            (args[0] / ('daily-' + DAY) / 'public/game.js').write_text('export class Game { broken syntax')
        with self.assertRaises(RuntimeError):
            self.invoke(agent=broken)
        self.assertFalse(any(a[0] == 'push' for a, _ in self.commands.calls))

    def test_concurrent_branch_update_is_not_forced(self):
        self.commands.reject_push = True
        with self.assertRaisesRegex(RuntimeError, 'non-fast-forward'):
            self.invoke()
        self.assertFalse(any(p == '/pulls' for p, _ in self.gh.calls))
        pushes = [a for a, _ in self.commands.calls if a[0] == 'push']
        self.assertEqual(pushes, [['push', 'origin', 'HEAD:refs/heads/daily-game/' + DAY]])


if __name__ == '__main__':
    unittest.main()
