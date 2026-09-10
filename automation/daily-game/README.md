# Daily games with Pi on Wasmer

The root `wasmer/edge-multiplayer-games` app owns the daily Edge job.
Its package serves the website and contains the `daily-game` command.
The job clones this repository, runs Pi, checks the generated game,
and pushes a dated branch. It opens a draft pull request against `main`.
The same `daily-game` command runs locally with Wasmer.

Pi messages, tool calls, and tool results appear on stdout as each event
completes. The coordinator then prints check results and the PR URL.
The job does not merge PRs, push to `main`, or use GitHub Actions.

## Prepare once

From the repository root:

```bash
npm ci --prefix automation/daily-game/pi --ignore-scripts --no-bin-links --no-audit --no-fund
npm run --prefix automation/daily-game/pi prepare:wasmer
```

The preparation step converts Pi's Unicode-set expressions for QuickJS.
Repeat it after each `npm ci`. The prepared dependencies are packaged at `/pi`.
The Wasmer filter includes Pi's bundled SDK and its Chord context module.
It excludes the remaining nested dependency tree, including native binaries for other platforms.
The installed npm tree remains intact for preparation. The upload shrinks from about 398 MiB to about 20 MiB.
Run all commands in this guide from the repository root.
The automation directory contains implementation files, not a separate Edge app.

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
mkdir -p automation/daily-game/output
wasmer run . -e daily-game --net --volume automation/daily-game/output:/output \
  --env "OPENAI_API_KEY=${OPENAI_API_KEY:?Set OPENAI_API_KEY first}" \
  -- --output /output
```

Read `automation/daily-game/output/daily-YYYY-MM-DD.patch` and its matching JSON report.
No remote branch or PR is created in this mode.
You can also use `--output` with `--publish`.

To publish that exact preview after setting `GH_TOKEN`:

```bash
wasmer run . -e daily-game --net --volume automation/daily-game/output:/output \
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
New runs write upload exclusions to `.wasmerignore`. Saved previews retain their original filter filename during recovery.

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

The root [`app.yaml`](../../app.yaml) configures `daily-game --publish` at `45 14 * * *`, or 14:45 UTC.
This is 17:45 in Helsinki during summer time.
The configuration requests a 50-minute timeout and no automatic retries.
The deployed cron currently reports 180 seconds because the backend reads timeout fields from a different location than the CLI writes.
Pi has a 30-minute limit within that invocation.

The root [`wasmer.toml`](../../wasmer.toml) defines the website and job commands in one package.
The default `serve` command serves only `/public`.
The scheduled command starts a separate invocation of that package with the root app's secrets.
The job creates a game PR against its own source repository, `wasmerio/edge-multiplayer-games`.
Merging the PR and deploying the game and index remain separate steps.

Set both secrets on **wasmer/edge-multiplayer-games** before deployment:

```bash
wasmer app secrets create OPENAI_API_KEY "${OPENAI_API_KEY:?Set OPENAI_API_KEY first}" --app wasmer/edge-multiplayer-games
wasmer app secrets create GH_TOKEN "${GH_TOKEN:?Set GH_TOKEN first}" --app wasmer/edge-multiplayer-games
./deploy.sh super
```

For existing secrets, update their values through the Wasmer dashboard before deployment.
Change `env.OPENAI_MODEL` in the root `app.yaml` to select the scheduled model.
For local runs, pass `-- --publish --model MODEL` or forward `OPENAI_MODEL` with `--env`.
`wasmer run` reads the package manifest, not the app's environment or Edge secrets.

Pi output goes to cron stdout, so it is available in the Edge job logs.
After deployment, check the enabled jobs and their effective timeouts.
The single `daily-game` job temporarily uses `--date 2026-09-09` to exercise generation without today's existing PR.
Remove the date override after validation succeeds so subsequent runs use the current UTC date.
The former standalone app manifests are removed. If you deployed that app separately, disable its schedule before activating the root schedule.

## Persistent run files

The `daily-game-runs` volume mounts at `/data`.
`DAILY_GAME_WORK_ROOT=/data` keeps each attempt in a separate `daily-YYYY-MM-DD-*` directory.
The checkout, temporary files, and agent home use that directory.
Failed attempts remain available. Retries create new directories.

The run directory contains:

- `repository/`: the checkout and generated source, including incomplete edits.
- `pi-control/input.txt`: the generation prompt, including repository instructions.
- `pi-control/pi.log`: Pi activity and tool results, appended as events arrive with the API key redacted.
- `pi-control/report.json`: the Pi result, when the supervisor completes.
- `artifacts/`: the validated patch and check report, when validation completes.
- `pr.json`: the PR URL, when publication completes.
- `status.json`: coordinator status. A killed process can leave this set to `running`.

Open the app dashboard's Storage tab and select **Explore files** on `daily-game-runs`.
Correlate the printed `Run files:` path with the cron invocation logs.
Volume writes can take time to appear outside the running instance.
The volume is outside the website's `/public` directory.
Run directories remain until you delete them through the volume file browser.

For a local run, create an empty host directory and mount it into Wasmer:

```bash
mkdir -p /tmp/edge-game-runs
wasmer run . -e daily-game --net --volume /tmp/edge-game-runs:/data \
  --env "OPENAI_API_KEY=${OPENAI_API_KEY:?Set OPENAI_API_KEY first}" \
  --env "GH_TOKEN=${GH_TOKEN:?Set GH_TOKEN first}" \
  -- --publish --work-root /data --date 2026-09-09
```

Without `--work-root` or `DAILY_GAME_WORK_ROOT`, local runs keep the existing temporary-directory behavior.
Pi still holds its active conversation in memory. Persistent files do not remove the runtime's memory requirements.

## Verification

The combined root WebC passed local checks on Wasmer 7.3.0.
Its default command served the exact root page and catalog. Runtime and configuration URLs returned 404.
Its `daily-game --help` command started successfully.
The Git/Pi probe passed HTTPS cloning, Pi startup, and commit/push checks against a disposable local remote.
The same artifact passed all 19 Python tests and the JavaScript runtime checks.
These checks made no model request and created no GitHub PR.
The root Edge deployment was blocked by the local command hook.

The local Git/Pi startup probe passed in Wasmer 7.3.0 and from a built WebC.
The new daily command starts in Wasmer. Its event renderer was checked there
with synthetic events.

Sixteen coordinator tests simulate Git and GitHub while running real JavaScript checks.
They cover preview export and reuse,
credential separation, failed validation, protected files, duplicate PRs,
rejected pushes, recovery after a successful push, injected instructions, and root catalog integrity.

```bash
python3 -m unittest discover -s automation/daily-game/test -v
node automation/daily-game/test/test_pi_events.mjs
node automation/daily-game/test/test_bash_operations.mjs
node automation/daily-game/test/test_capture.mjs
```

Run the complete suite inside the root Wasmer package:

```bash
wasmer run . -e node --volume .:/repository \
  -- /repository/automation/daily-game/test/wasmer.mjs
```

This command runs all 25 Python tests plus the JavaScript runtime checks.
Four integration tests use real Git in disposable guest repositories.
They cover source mutation, staged-only edits, preview mutation, and Git attribute conversion.
The suite uses no model API, GitHub token, or external Git remote.
Native unit tests skip those four integration tests and run game checks directly.
The Wasmer suite also checks the subprocess output limit.
It starts a real Pi SDK session and exercises its read, write, edit, and Bash tools without a model request.
This check detects missing runtime dependencies in the filtered package.

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
