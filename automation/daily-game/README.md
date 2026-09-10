# Daily games with Pi on Wasmer

The Edge job clones this repository, runs Pi, checks the generated game,
and pushes a dated branch. It opens a draft pull request against `main`.
The same `daily-game` command runs locally with Wasmer.

Pi messages, tool calls, and tool results appear on stdout as each event
completes. The coordinator then prints check results and the PR URL.
The job does not merge PRs, push to `main`, or use GitHub Actions.

## Prepare once

From the repository root:

```bash
cd automation/daily-game
npm ci --prefix pi --ignore-scripts --no-bin-links --no-audit --no-fund
npm run --prefix pi prepare:wasmer
```

The preparation step converts Pi's Unicode-set expressions for QuickJS.
Repeat it after each `npm ci`. The prepared dependencies are packaged at `/pi`.

## Generate and open a real PR

Set `OPENAI_API_KEY` and `GH_TOKEN` in your shell, then run:

```bash
wasmer run . -e daily-game --net \
  --env "OPENAI_API_KEY=${OPENAI_API_KEY:?Set OPENAI_API_KEY first}" \
  --env "GH_TOKEN=${GH_TOKEN:?Set GH_TOKEN first}" \
  -- --publish
```

This command uses the model API and writes to GitHub.
It pushes `daily-game/YYYY-MM-DD` and opens a draft PR into `main`.
The final line is `PR: https://github.com/...`.

The token needs access to this repository with **Contents: read and write**
and **Pull requests: read and write**. Actions permission is not needed.
A GitHub CLI installation is not needed.

The coordinator gives `GH_TOKEN` only to its GitHub API client.
For HTTPS Git operations, it derives an authorization header and passes
that header through the Git subprocess environment. Pi and game checks
do not receive the GitHub credential.

Pi receives `OPENAI_API_KEY` for model authentication.
Game checks run with an explicit environment without either credential.
This is process separation, not a hardened sandbox between the agent and coordinator.

## Preview without a remote write

A preview still uses the model API. Mount an output directory to keep
the patch and check report after Wasmer exits:

```bash
mkdir -p output
wasmer run . -e daily-game --net --volume output:/output \
  --env "OPENAI_API_KEY=${OPENAI_API_KEY:?Set OPENAI_API_KEY first}" \
  -- --output /output
```

Read `output/daily-YYYY-MM-DD.patch` and its matching JSON report.
No remote branch or PR is created in this mode.
You can also use `--output` with `--publish`.

To publish that exact preview after setting `GH_TOKEN`:

```bash
wasmer run . -e daily-game --net --volume output:/output \
  --env "GH_TOKEN=${GH_TOKEN:?Set GH_TOKEN first}" \
  -- --publish --from-preview /output --date YYYY-MM-DD
```

Use the date from the saved filenames. This command repeats validation,
commits the saved game, pushes its branch, and opens the draft PR.
It does not call the model. To repeat validation without publication,
replace `--publish` with `--output /output` and omit the token.

The default repository is `wasmerio/edge-multiplayer-games`.
Use `--repository OWNER/REPO` for another compatible game repository,
`--date YYYY-MM-DD` to select a date, or `--model MODEL` to select a model.

## Output

A run prints activity such as:

```text
Daily game 2026-09-10: publish draft PR
[pi start]
[pi message] I will inspect the reference game.
[pi tool read] {"path":"AGENTS.md"}
[pi tool bash] {"command":"cd daily-2026-09-10 && node test/run.mjs"}
[pi tool done] ...
[pi done]
PASS game checks: ...
RUN git commit
RUN git push
PR: https://github.com/...
```

This is an example, not a record of a completed generation.
Messages are printed when complete; private reasoning is not included.
Long tool output is limited to 12,000 characters per event.
Known credential values are redacted.
A provider error, timeout, or incomplete agent response stops publication.
A run must also contain a successful Bash tool result.

## Runtime adaptations

The job uses Pi's SDK with in-memory credentials, settings, and sessions.
The default credential-file lock requires `utime`, which Edge.js does not support.
Pi still selects tools, edits files, and runs the checks.

Pi's Bash tool uses custom process operations with `detached: false`.
WASIX supports Bash subprocesses but rejects detached process groups with
`spawn ENOSYS`. Output, exit status, cancellation, and timeout checks run
against this adapter in Wasmer.
Cancellation closes inherited output pipes and kills the immediate child.
A Bash timeout also stops Pi and fails the job before publication.
The adapter cannot kill a whole process group. The job exits after a timeout
instead of continuing with possible descendants in the guest.

The coordinator disables Git's pager because `less` is not installed.
It clones the selected branch with history. A real shallow-fetch replay failed
inside WASIX with `shallow file has changed since we read it`.

The smaller `probe` command now streams Pi activity too:

```bash
wasmer run . -e probe --net \
  --env "OPENAI_API_KEY=${OPENAI_API_KEY:?Set OPENAI_API_KEY first}" \
  -- --agent
```

That command edits a fixture and pushes to a disposable local Git remote.
See [PROBE.md](PROBE.md) for the test without model access.

## Checks and publication

The coordinator restricts edits to the new game's source files.
It preserves the signaling server and client transport prefix.
It injects the cloned repository's full AGENTS.md and registration contract into Pi's input.
It constructs the app manifest, package files, test runner, both catalog entries,
and root upload exclusion itself.

Before publication, it checks JavaScript syntax, the Game interface,
and at least two simulation scenarios. The draft PR lists browser gameplay,
invite flow, and deployment as pending.
Complete the repository AGENTS.md checklist before publishing the game.

The job compares repository contents before and after the generated tests.
It rejects file changes, deletions, permission changes, and Git configuration changes.
Before a commit, it rebuilds the index and compares staged Git objects with
the exact source bytes that passed validation.
The simulation check has a 60-second deadline and a combined output limit of 2 MiB.

Every new PR adds an entry to the root `public/games.json` catalog with `url: null`.
The superapp shows that entry as coming soon and disables its play buttons.
The generated `game-entry.json` supplies its name, description, player count, and source path.
The internal `automation/daily-game/catalog.json` is a generation record; the superapp does not read it.

After merging the PR, run this command from the repository root:

```bash
./deploy.sh daily-YYYY-MM-DD super
```

The script deploys the game, reads its actual URL from Wasmer, updates the root catalog,
and deploys the superapp. It also adds missing entries from older generated games.
If the game is already deployed, `./deploy.sh super` resolves any missing catalog URLs before the root deployment.
Commit the catalog URL and CLI manifest changes after deployment.
Saved previews from older versions remain recoverable; deployment adds their missing root entries.

## Reruns and failures

The branch and PR are identified by the UTC date.
If a PR already exists, including a closed PR, a repeat run prints its URL
and skips generation. If the game is already on `main`, the job also stops.

If the branch push succeeds but PR creation fails, rerun the same command.
The coordinator clones that branch, repeats validation, and opens the PR
without another model call or push.

Pushes are ordinary Git pushes. A conflicting branch update fails.
Concurrent runs can spend on generation before one push loses the race.
The job does not overwrite another candidate with a forced push.

## Edge schedule

`app.yaml` configures `daily-game --publish` at `0 6 * * *`, or 06:00 UTC.
The timeout is 50 minutes and automatic retries are disabled.
Pi has a 30-minute limit within that invocation.

Set `OPENAI_API_KEY` and `GH_TOKEN` as Edge secrets when deploying this package.
Pi output goes to cron stdout, so it is available in the Edge job logs.
This configuration has not been deployed or verified in an Edge invocation.

## Verification

The local Git/Pi startup probe passed in Wasmer 7.3.0 and from a built WebC.
The new daily command starts in Wasmer. Its event renderer was checked there
with synthetic events.

Fifteen coordinator tests simulate Git and GitHub while running real JavaScript checks.
They cover preview export and reuse,
credential separation, failed validation, protected files, duplicate PRs,
rejected pushes, recovery after a successful push, injected instructions, and root catalog integrity.

```bash
python3 -m unittest discover -s test -v
node test/test_pi_events.mjs
node test/test_bash_operations.mjs
node test/test_capture.mjs
```

Run the complete suite inside Wasmer from this directory:

```bash
wasmer run . -e node --volume ../..:/repository \
  -- /repository/automation/daily-game/test/wasmer.mjs
```

This command runs all 19 Python tests plus the JavaScript runtime checks.
Four integration tests use real Git in disposable guest repositories.
They cover source mutation, staged-only edits, preview mutation, and Git attribute conversion.
The suite uses no model API, GitHub token, or external Git remote.
Native unit tests skip those four integration tests and run game checks directly.
The Wasmer suite also checks the subprocess output limit.

## Maintenance

| Module | Responsibility |
|---|---|
| `daily_game.py` | Generation, preview recovery, and publication sequence |
| `game_contract.py` | Game layout and preserved multiplayer files |
| `repository.py` | File integrity and checked Git objects |
| `processes.py` | Shared WASIX subprocess behavior |
| `pi_entry.mjs`, `run_pi.mjs` | Pi session and event supervision |
| `bash_operations.mjs`, `capture.mjs` | Command deadlines and bounded test output |
| `github.py` | GitHub API requests |

The production job and diagnostic probe share the process helper.
The job does not import the probe implementation.
Keep the Wasmer compatibility changes in these adapters when updating Pi or runtime packages.
See [REVIEW.md](REVIEW.md) for the independent review and its resolutions.

## Recorded generation

A real Pi repair test passed inside Wasmer: Pi observed the failing test,
edited the fixture, and reran its Bash test successfully.
On 2026-09-10, Pi generated Meteor Market entirely inside `wasmer run`.
Its five simulation scenarios, syntax checks, and mocked client lifecycle passed.
The coordinator independently validated the game and exported its patch.
The saved patch also passed a fresh Git clone, patch application, and validation
inside Wasmer without a model request.
The run left real HTTP and browser checks pending because the game dependency
`ws` and a browser were not installed in the job.
Authenticated Git push and draft PR creation passed from the built WebC package.
The result is [PR #1: Meteor Market](https://github.com/wasmerio/edge-multiplayer-games/pull/1),
from `daily-game/2026-09-10` into `main`.
A separate GitHub API check inside Wasmer confirmed all 16 changed files match
the saved Pi patch. The commit is `0d3ffdb3f7dc93c68788519006dff91e3f059186`.
Publication reused the saved game and made no additional model request.
The Edge schedule itself remains undeployed and unverified.

References: [GitHub pull requests](https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request)
and [Git credentials](https://git-scm.com/docs/gitcredentials).
