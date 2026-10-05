import argparse
import contextlib
import io
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

from fixtures import ROOT, DAY, BASE, REPORT, candidate, engine_version, game_js, repository_files, copy_binary_tooling, write_candidate
import daily_game as job
import game_contract

SLUG = 'weekly-' + DAY


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
        self.base = repository_files()
        self.binary = set()
        self.node = shutil.which('node')

    def files(self):
        return {str(p.relative_to(self.work)): p.read_text() for p in self.work.rglob('*')
                if p.is_file() and '.git' not in p.relative_to(self.work).parts
                and str(p.relative_to(self.work)) not in self.binary}

    def __call__(self, args, cwd, env, timeout=60, strip=True, failure_output=False):
        if args[0] == '/bin/node':
            if args[1].endswith('/capture.mjs') and not os.environ.get('WASMER_GIT_TESTS'):
                args = args[4:]
            previous = os.getcwd()
            try:
                os.chdir(cwd)
                result = subprocess.run([self.node if arg == '/bin/node' else arg for arg in args], env=env,
                                        capture_output=True, text=True, timeout=120)
            finally:
                os.chdir(previous)
            if result.returncode:
                raise RuntimeError((result.stdout + result.stderr) if failure_output else result.stderr)
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
            self.binary = copy_binary_tooling(self.work)
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
            files = self.files()
            return '\n'.join(p for p, text in self.base.items() if files.get(p) != text)
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

    def agent(self, work, env, system, prompt, model, **overrides):
        self.agent_env = env
        self.agent_input = json.loads(prompt.removeprefix('INPUT\n'))
        self.scaffold = {str(p.relative_to(work / SLUG)): p.read_bytes()
                         for p in (work / SLUG).rglob('*') if p.is_file()}
        write_candidate(work, SLUG, **overrides)
        return {'ok': True, 'bashCalls': 1}

    def rejects(self, pattern, agent=None, error=ValueError):
        """A rejected candidate publishes nothing and registers nothing."""
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as output:
            self.args.work_root, self.args.output = root, output
            with self.assertRaisesRegex(error, pattern):
                self.invoke(agent=agent)
            self.assertFalse(any(a[0] in {'push', 'commit', 'add'} for a, _ in self.commands.calls))
            self.assertFalse(any(p == '/pulls' for p, _ in self.gh.calls))
            self.assertEqual(list(Path(output).iterdir()), [])
            attempt, = Path(root).iterdir()
            work = attempt / 'repository'
            if work.is_dir():
                for name in ('public/games.json', '.wasmerignore'):
                    self.assertEqual((work / name).read_text(), self.commands.base[name])
                self.assertFalse((work / game_contract.CATALOG).exists())
                self.assertFalse((work / 'automation/daily-game/runs').exists())
            return work

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
        self.assertEqual(push, ['push', 'origin', 'HEAD:refs/heads/weekly-game/' + DAY])
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
            self.assertTrue((attempt / 'repository' / ('weekly-' + DAY) / 'public/game.js').is_file())
            self.assertTrue((attempt / 'artifacts' / ('weekly-' + DAY + '.patch')).is_file())
            self.assertEqual(json.loads((attempt / 'pr.json').read_text())['url'], self.gh.pull['html_url'])
            self.assertEqual(json.loads((attempt / 'status.json').read_text())['status'], 'completed')
            self.assertEqual(Path(self.agent_env['TMPDIR']), attempt)
            self.assertTrue(Path(self.agent_env['HOME']).is_relative_to(attempt))

    def test_persistent_run_retains_failed_agent_edits(self):
        with tempfile.TemporaryDirectory() as root:
            self.args.work_root = root
            def fail(work, *args):
                (work / ('weekly-' + DAY) / 'public/game.js').write_text('partial candidate')
                raise RuntimeError('Pi stopped')
            with self.assertRaisesRegex(RuntimeError, 'Pi stopped'):
                self.invoke(agent=fail)
            attempt, = Path(root).iterdir()
            self.assertEqual((attempt / 'repository' / ('weekly-' + DAY) / 'public/game.js').read_text(), 'partial candidate')
            self.assertEqual(json.loads((attempt / 'status.json').read_text())['status'], 'failed')
            self.assertFalse(any(args[0] == 'push' for args, env in self.commands.calls))

    def test_prompt_injects_guide_and_pr_registers_root_catalog(self):
        self.invoke()
        self.assertEqual(self.agent_input['repository_instructions'], (ROOT / 'AGENTS.md').read_text())
        self.assertEqual(self.agent_input['registration_contract']['catalog'], 'public/games.json')
        self.assertEqual(self.agent_input['registration_contract']['upload_filter'], '.wasmerignore')
        self.assertEqual(self.agent_input['engine']['version'], engine_version())
        self.assertIn(SLUG + '/public/game.js', self.agent_input['editable_paths'])
        self.assertIn(SLUG + '/src/server.js', self.agent_input['coordinator_owned_paths'])
        self.assertIn(f'node scripts/conformance.mjs {SLUG} --static', self.agent_input['checks'])
        self.assertNotIn('.ignore', self.commands.published)
        original = json.loads(self.commands.base['public/games.json'])
        published = json.loads(self.commands.published['public/games.json'])
        self.assertEqual(published[:-1], original)
        self.assertEqual(published[-1], {
            'slug': SLUG, 'name': candidate()['name'],
            'description': candidate()['description'], 'players': '2 to 8',
            'source': SLUG + '/', 'url': None,
        })
        self.assertEqual(json.loads(self.commands.published[SLUG + '/game-entry.json']),
                         {key: value for key, value in published[-1].items() if key != 'url'})
        self.assertIn('/' + SLUG + '/\n', self.commands.published['.wasmerignore'])

    def test_dry_run_produces_a_complete_game_that_passes_static_conformance(self):
        self.args.publish = False
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as output:
            self.args.work_root, self.args.output = root, output
            self.invoke()
            attempt, = Path(root).iterdir()
            work = attempt / 'repository'
            game = work / SLUG
            written = {str(p.relative_to(game)) for p in game.rglob('*') if p.is_file()}
            self.assertEqual(written, set(self.scaffold))
            for path, content in self.scaffold.items():
                if not game_contract.editable(path):
                    self.assertEqual((game / path).read_bytes(), content, path)
            self.assertTrue({'src/server.js', 'package.json', 'app.yaml', '.gitignore', 'public/index.html',
                             'public/client.js', 'public/game.js', 'test/replay.ndjson', 'README.md',
                             'game-entry.json'} <= written)
            self.assertTrue((game / 'README.md').read_text().endswith(game_contract.PENDING))
            # WASIX subprocesses take no cwd, so the script and the game are named absolutely.
            result = subprocess.run([self.commands.node, str(work / 'scripts/conformance.mjs'), str(game), '--static'],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            report = json.loads((Path(output) / (SLUG + '.json')).read_text())
            self.assertEqual(report['checks']['conformance']['tier'], 'static')
            self.assertIn('fixture', report['checks']['conformance']['rows'])
            self.assertEqual(report['checks']['engine'], engine_version())
            self.assertGreaterEqual(report['checks']['scenarios'], 2)
            self.assertEqual(report['browser_checks'], 'pending')
            self.assertTrue((Path(output) / (SLUG + '.patch')).is_file())
        self.assertFalse(any(a[0] in {'push', 'commit'} for a, _ in self.commands.calls))
        self.assertFalse(self.gh.calls)
        self.assertEqual(self.commands.base, repository_files())

    def test_generated_game_pins_the_engine_version_the_generator_ran_against(self):
        self.invoke()
        pin = f'"@engine/": "https://edge-multiplayer-games.wasmer.app/engine/{engine_version()}/"'
        self.assertIn(pin, self.commands.published[SLUG + '/public/index.html'])
        self.assertEqual(self.agent_input['engine']['pin'], game_contract.engine_pin(engine_version()))
        record = json.loads(self.commands.published['automation/daily-game/runs/' + DAY + '.json'])
        self.assertEqual(record['checks']['engine'], engine_version())

    def test_repointed_engine_pin_is_rejected(self):
        def repin(work, *args):
            self.agent(work, *args)
            page = work / SLUG / 'public/index.html'
            page.write_text(page.read_text().replace(f'/engine/{engine_version()}/', '/engine/0.9.0/'))
        self.rejects('Engine import map differs from the scaffold', repin)

    def test_scaffold_pinned_to_another_engine_version_is_rejected(self):
        page = b'<script type="importmap">{ "imports": { "@engine/": "https://edge-multiplayer-games.wasmer.app/engine/0.9.0/" } }</script>'
        files = {'public/index.html': page, 'README.md': b'', 'public/game.js': b'', 'public/client.js': b'',
                 'game-entry.json': b'{}', 'test/replay.ndjson': b''}
        with self.assertRaisesRegex(ValueError, r'Engine pin is not .*/engine/1\.0\.0/; the generator ran against engine 1\.0\.0'):
            game_contract.verify(files, files, {'slug': SLUG, 'engine_version': '1.0.0', 'existing_games': []})

    def test_missing_simulation_method_names_the_method(self):
        self.rejects(r'Game rejected: .*missing method winner\(\)',
                     lambda *args: self.agent(*args, game_js=game_js(winner='champion')))

    def test_snapshot_over_budget_names_the_budget(self):
        self.rejects(r'Snapshot exceeds its budget: .*SNAPSHOT_BUDGET_BYTES \(100 bytes per player per tick',
                     lambda *args: self.agent(*args, game_js=game_js(fat=True)))

    def test_fixture_that_does_not_replay_names_the_divergence(self):
        def tamper(work, *args):
            self.agent(work, *args)
            fixture = work / SLUG / 'test/replay.ndjson'
            header, rest = fixture.read_text().split('\n', 1)
            header = json.loads(header)
            header['final']['scores'][0] += 7
            fixture.write_text(json.dumps(header) + '\n' + rest)
        self.rejects(r'Fixture does not replay: replay: diverged recorded \{.*\} reached \{.*\}', tamper)

    def test_missing_fixture_is_rejected(self):
        def forget(work, *args):
            self.agent(work, *args)
            (work / SLUG / 'test/replay.ndjson').unlink()
        self.rejects('Scaffold file is missing: test/replay.ndjson', forget)

    def test_unpublished_engine_version_names_the_version_before_authoring(self):
        self.commands.base['engine/params.js'] = self.commands.base['engine/params.js'].replace(
            f'"{engine_version()}"', '"9.9.9"')
        self.rejects(r'Engine version 9\.9\.9 is not published: public/engine/9\.9\.9/ is missing',
                     lambda *args: self.fail('Pi must not run against an unpublished engine'))

    def test_published_engine_copy_that_drifted_is_rejected_before_authoring(self):
        self.commands.base[f'public/engine/{engine_version()}/sim.js'] += '// drift\n'
        self.rejects(rf'Engine version {re.escape(engine_version())} is not published: .*sim\.js differs',
                     lambda *args: self.fail('Pi must not run against a drifted engine'))

    def test_absent_scaffold_command_names_the_command(self):
        del self.commands.base['scripts/new-game.mjs']
        self.rejects('Scaffold command is missing: node scripts/new-game.mjs',
                     lambda *args: self.fail('Pi must not run without a scaffold'))

    def test_absent_conformance_fails_generation_instead_of_skipping_the_gate(self):
        del self.commands.base['scripts/conformance.mjs']
        self.rejects('Conformance command is missing: node scripts/conformance.mjs; the gate is never skipped',
                     lambda *args: self.fail('Pi must not run without the gate'))

    def test_conformance_that_cannot_run_fails_generation(self):
        self.commands.base['scripts/conformance.mjs'] = 'throw new Error("no browser in this environment");\n'
        self.rejects('(?s)Conformance failed: .*no browser in this environment')

    def test_silent_conformance_is_not_a_pass(self):
        self.commands.base['scripts/conformance.mjs'] = '\n'
        self.rejects('Conformance produced no report; the gate is never skipped')

    def test_failed_conformance_row_is_named(self):
        self.rejects('Conformance failed: readme: README.md has no heading for: snapshot',
                     lambda *args: self.agent(*args, readme='# Sprint\n\n## Input\nMove.\n\n## Round lifecycle\nSnapshot prose only.\n'))

    def test_coordinator_owned_file_must_match_the_scaffold(self):
        for path in ('src/server.js', 'package.json', 'app.yaml', '.gitignore'):
            with self.subTest(path=path):
                self.setUp()
                def edit(work, *args, path=path):
                    self.agent(work, *args)
                    with (work / SLUG / path).open('a') as file:
                        file.write('\n')
                self.rejects('Coordinator-owned file differs from the scaffold: ' + re.escape(path), edit)

    def test_unmodified_scaffold_is_not_a_game(self):
        def idle(work, *args):
            scaffold = {p: p.read_bytes() for p in (work / SLUG / 'public').glob('*.js')}
            self.agent(work, *args)
            for path, content in scaffold.items():
                path.write_bytes(content)
        self.rejects('Scaffold placeholder was not replaced: public/game.js', idle)

    def test_duplicate_game_name_is_rejected(self):
        taken = json.loads(self.commands.base['public/games.json'])[0]['name']
        self.rejects('Game name already exists', lambda *args: self.agent(*args, name=taken.upper()))

    def test_oversized_game_file_is_rejected(self):
        self.rejects('Game file exceeds size limit: public/game.js',
                     lambda *args: self.agent(*args, game_js=game_js() + '//' + 'x' * 500000 + '\n'))

    def test_stray_game_file_is_rejected(self):
        def stray(work, *args):
            self.agent(work, *args)
            (work / SLUG / 'public/extra.css').write_text('body{}')
        self.rejects('Unexpected changed paths: ' + SLUG + '/public/extra.css', stray)

    def test_scaffold_default_theme_is_not_a_visual_identity(self):
        def default_theme(work, *args):
            self.agent(work, *args, style_css=(work / SLUG / 'public/style.css').read_text())
        self.rejects("Stylesheet is the scaffold's default theme: public/style.css; the game needs its own visual identity",
                     default_theme)
        self.rejects('Stylesheet is missing or empty: public/style.css', lambda *args: self.agent(*args, style_css='\n'))

    def test_generated_game_ships_its_own_page_and_stylesheet(self):
        self.invoke()
        page = self.commands.published[SLUG + '/public/index.html']
        style = self.commands.published[SLUG + '/public/style.css']
        self.assertEqual(style, candidate()['style_css'])
        self.assertNotEqual(style.encode(), self.scaffold['public/style.css'])
        self.assertIn('Open a lane', page)
        self.assertIn('data-engine-touch="move=1"', page)
        self.assertIn('data-engine-stick="move,move"', page)
        self.assertNotIn(game_contract.PLACEHOLDER, page)
        for role in game_contract.REQUIRED_ROLES:
            self.assertIn(f'data-engine="{role}"', page)
        self.assertIn(SLUG + '/public/style.css', self.agent_input['editable_paths'])
        self.assertIn(SLUG + '/public/index.html', self.agent_input['editable_paths'])
        self.assertIn('visual_identity', self.agent_input)

    def test_page_must_keep_what_the_engine_binds_to(self):
        def page_with(change):
            def author(work, *args):
                self.agent(work, *args)
                page = work / SLUG / 'public/index.html'
                before = page.read_text()
                after = change(before)
                self.assertNotEqual(before, after)
                page.write_text(after)
            return author
        cases = [
            ('Page is missing data-engine role: start', lambda page: page.replace('data-engine="start"', 'data-role="start"')),
            ('Page is missing data-engine role: arena, invite-link',
             lambda page: page.replace('data-engine="arena"', '').replace('data-engine="invite-link"', '')),
            ('Page repeats data-engine role: status', lambda page: page.replace('data-engine="hud"', 'data-engine="status"')),
            ('Page has no link back to https://edge-multiplayer-games.wasmer.app',
             lambda page: page.replace('href="https://edge-multiplayer-games.wasmer.app"', 'href="https://example.com"')),
            ('Page does not load /client.js as its one module script',
             lambda page: page.replace('<script type="module" src="/client.js"></script>', '')),
            ('Page has a script besides the import map and /client.js',
             lambda page: page.replace('</body>', '<script>new WebSocket("wss://x")</script></body>')),
            ('Page does not link /style.css', lambda page: page.replace('<link rel="stylesheet" href="/style.css">', '')),
        ]
        for message, change in cases:
            with self.subTest(message):
                self.rejects(re.escape(message), page_with(change))

    def test_page_left_as_the_scaffold_is_rejected(self):
        def untouched(work, *args):
            page = (work / SLUG / 'public/index.html').read_text()
            self.agent(work, *args, page_html=page)
        self.rejects("Page still carries the scaffold's placeholder copy", untouched)

    def test_touch_button_for_an_unknown_intent_field_fails_the_slots_row(self):
        def stale_touch(work, *args):
            page = (work / SLUG / 'public/index.html').read_text()
            self.agent(work, *args, page_html=page.replace(game_contract.PLACEHOLDER_DESCRIPTION, 'Reach the wall.')
                       .replace(game_contract.PLACEHOLDER, 'Fixture sprint'))
        self.rejects('Conformance failed: slots: data-engine-touch names unknown intent field boost', stale_touch)

    def test_runtime_references_no_deleted_template_file_or_split_string(self):
        runtime = Path(game_contract.__file__).resolve().parent
        banned = ('applyMessage', 'SPLIT', 'REFERENCE', 'package-lock', 'client_tail',
                  'client_boundary', 'transport prefix', 'run.mjs', 'scenarios.js', 'scenario_contract')
        sources = [p for p in runtime.iterdir() if p.is_file()]
        self.assertGreater(len(sources), 10)
        self.assertFalse((runtime / 'run.mjs').exists())
        for source in sources:
            text = source.read_text()
            for word in banned:
                self.assertNotIn(word, text, f'{source.name} still references {word}')
            for copied in ('achtung/public', 'achtung/src', 'achtung/package'):
                self.assertNotIn(copied, text.replace('achtung/public/game.js, achtung/public/client.js', ''),
                                 f'{source.name} copies from the reference game')

    def test_saved_preview_rejects_root_catalog_replacement(self):
        with tempfile.TemporaryDirectory() as output:
            self.args.publish = False
            self.args.output = output
            self.invoke()
            patchfile = Path(output) / ('weekly-' + DAY + '.patch')
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
            self.assertTrue((Path(output) / ('weekly-' + DAY + '.patch')).is_file())
            self.assertEqual(json.loads((Path(output) / ('weekly-' + DAY + '.json')).read_text())['checks']['ok'], True)
        self.assertFalse(any(a[0] in {'push', 'commit'} for a, _ in self.commands.calls))
        self.assertFalse(self.gh.calls)

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
            patchfile = Path(output) / ('weekly-' + DAY + '.patch')
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
            patchfile = Path(output) / ('weekly-' + DAY + '.patch')
            reportfile = Path(output) / ('weekly-' + DAY + '.json')
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
            (args[0] / SLUG / 'public/game.js').write_text('export class Simulation { broken syntax')
        self.rejects('JavaScript syntax check failed: public/game.js', broken)

    def test_concurrent_branch_update_is_not_forced(self):
        self.commands.reject_push = True
        with self.assertRaisesRegex(RuntimeError, 'non-fast-forward'):
            self.invoke()
        self.assertFalse(any(p == '/pulls' for p, _ in self.gh.calls))
        pushes = [a for a, _ in self.commands.calls if a[0] == 'push']
        self.assertEqual(pushes, [['push', 'origin', 'HEAD:refs/heads/weekly-game/' + DAY]])


if __name__ == '__main__':
    unittest.main()
