"""Exercise the actual Git index in disposable Wasmer repositories."""

import argparse
import contextlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fixtures import ROOT, DAY
import test_daily_game as fixtures
import daily_game as job
from processes import execute
from repository import stage_checked_files


@unittest.skipUnless(os.environ.get('WASMER_GIT_TESTS') == '1', 'Run real Git tests inside Wasmer')
class GitIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = job.environment(self.root)
        self.seed = self.root / 'seed'
        self.seed.mkdir()
        for name in (*job.REFERENCE, '.ignore'):
            dest = self.seed / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes((ROOT / name).read_bytes())
        self.git('init', '--initial-branch=main')
        self.git('add', '.')
        self.git('commit', '-m', 'Seed integration fixture')
        self.remote = self.root / 'remote.git'
        self.git('clone', '--bare', str(self.seed), str(self.remote))
        self.gh = fixtures.FakeGitHub()
        self.args = argparse.Namespace(date=DAY, repository='wasmerio/edge-multiplayer-games',
                                       publish=True, output=None, model='fixture', from_preview=None)
        self.pushed = False

    def git(self, *args, cwd=None):
        return execute(['/bin/git', '-c', 'core.hooksPath=/dev/null', *args], cwd or self.seed, self.env)

    def command(self, args, cwd, env, timeout=60, strip=True):
        args = list(args)
        if args[0] == '/bin/git' and args[3] == 'clone':
            args[-2] = str(self.remote)
        result = execute(args, cwd, env, timeout=timeout, strip=strip)
        if args[0] == '/bin/git' and args[3] == 'push':
            self.pushed = self.gh.has_branch = True
        return result

    def agent(self, work, env, system, prompt, model):
        fixtures.DailyGameTests.agent(self, work, env, system, prompt, model)

    def invoke(self, agent=None):
        with patch.dict(os.environ, {'GH_TOKEN': 'fixture-token', 'OPENAI_API_KEY': 'fixture-model'}), \
             patch.object(job, 'GitHub', return_value=self.gh), \
             patch.object(job, 'execute', side_effect=self.command), \
             patch.object(job, 'run_pi', side_effect=agent or self.agent), \
             contextlib.redirect_stdout(io.StringIO()):
            job.run(self.args)

    def test_generated_scenario_cannot_publish_unchecked_source(self):
        def mutator(*args):
            self.agent(*args)
            scenario = args[0] / ('daily-' + DAY) / 'test/scenarios.js'
            scenario.write_text(scenario.read_text() + '''
import fs from 'node:fs';
scenarios.push({name: 'source mutation', run(Game, assert) {
  fs.writeFileSync('public/client.js', 'unchecked source'); assert(true);
}});
''')
        with self.assertRaisesRegex(ValueError, 'Game checks changed repository files'):
            self.invoke(mutator)
        self.assertFalse(self.pushed)
        self.assertIsNone(self.gh.pull)

    def test_staged_only_edit_is_excluded_from_published_commit(self):
        def staged_edit(*args):
            self.agent(*args)
            work = args[0]
            original = (work / 'AGENTS.md').read_bytes()
            (work / 'AGENTS.md').write_text('staged unchecked instructions')
            self.git('add', 'AGENTS.md', cwd=work)
            (work / 'AGENTS.md').write_bytes(original)
        self.invoke(staged_edit)
        self.assertTrue(self.pushed)
        published = self.git('--git-dir=' + str(self.remote), 'show', 'daily-game/' + DAY + ':AGENTS.md')
        self.assertEqual(published, (ROOT / 'AGENTS.md').read_text().strip())

    def test_saved_preview_rejects_worktree_mutation(self):
        self.args.publish = False
        self.args.output = str(self.root / 'output')
        self.invoke()
        self.args.publish = True
        self.args.from_preview = self.args.output
        original = job.check_game
        def mutate(work, slug, env):
            result = original(work, slug, env)
            (work / slug / 'public/client.js').write_text('unstaged unchecked replacement')
            return result
        with patch.object(job, 'check_game', side_effect=mutate):
            with self.assertRaisesRegex(ValueError, 'Game checks changed repository files'):
                self.invoke(lambda *args: self.fail('Preview must not regenerate'))
        self.assertFalse(self.pushed)

    def test_git_attributes_cannot_change_checked_bytes(self):
        (self.seed / '.gitattributes').write_text('checked.txt text eol=lf\n')
        (self.seed / 'checked.txt').write_bytes(b'checked bytes\r\n')
        def git(*args, raw=False):
            return execute(['/bin/git', '-c', 'core.hooksPath=/dev/null', *args], self.seed, self.env, strip=not raw)
        with self.assertRaisesRegex(ValueError, 'Staged file differs from checked source'):
            stage_checked_files(git, {'checked.txt': b'checked bytes\r\n'})


if __name__ == '__main__':
    unittest.main()
