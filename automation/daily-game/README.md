# Daily generation on Edge

The requested architecture now uses Git clone, Pi, and Git commit/push.
The [runtime proof](PROBE.md) must pass before it replaces the implementation
described here. This earlier custom generator remains inactive.

To test Git and Pi locally with Wasmer, follow [the probe commands](PROBE.md).
Run the probe before considering deployment. The `app.yaml` job below still
points to the earlier generator; it does not invoke Pi.

The earlier source-generation prototype uses this sequence:

1. Read `main`, the repository guide, the catalog, and the Achtung reference files through the GitHub API.
2. Claim the current UTC date with an atomic Git tag creation.
3. Call the OpenAI Responses API directly from Edge.
4. Assemble the returned source into a new game directory.
5. Run JavaScript syntax, Game interface, and simulation scenario checks inside Edge.
6. If a source check fails, request a repair, with at most three generation attempts.
7. Create one commit and advance `main` through the GitHub Git API.

There are no GitHub Actions workflows, dispatch requests, artifact downloads,
or external execution runners. The language model runs behind its API.
The Python job on Edge owns generation requests, file assembly, checks, and the push.
GitHub provides repository storage and its Git API.

The schedule is `0 6 * * *`: daily at 06:00 UTC.
Each successful date creates a directory such as `daily-2026-09-10/`.
The model chooses a display name and mechanics from the existing catalog.

## Runtime

The package contains Python and the embedded QuickJS version of Edge.js.
Python runs `/app/cron.py`. The packaged `node` command runs headless checks.
The normal app process serves `/healthz` and has no generation endpoint.

The model returns a fixed JSON schema with source fields. It does not receive
a shell, GitHub credentials, or permission to choose repository paths.
The coordinator constructs `app.yaml`, both package files, the test harness,
and the game directory. It copies the signaling server and client transport
from the fixed reference commit.

The generated simulation and scenarios run in a subprocess with an explicit
environment that excludes the API credentials. Each check has a 30-second timeout.
This is process separation, not a claim of a hardened untrusted-code sandbox.

The model request uses background mode, with a shared 35-minute deadline
and at most 32,768 output tokens per attempt. The Edge job timeout is 50 minutes.
Model API errors stop the run. A missing JavaScript runtime also stops the run.
Neither condition produces an unchecked commit.

## Source commits and publishing

Each commit contains the new game, its upload exclusion, a source catalog
entry, and a completion record under `runs/`.
The source catalog includes earlier generated games to reduce repetition.
The model's choice of distinct mechanics still needs human assessment.

The cron job checks syntax and headless behavior. It does not run Chromium,
deploy the new app, or update the live `public/games.json` catalog.
Each game README and completion record marks browser checks and deployment
as pending. A source commit is not a claim that the game passes the full
AGENTS.md completion checklist.

Before publishing a generated game, complete that checklist.
Use the generated `game-entry.json` as catalog metadata after deployment
provides the actual app URL. The existing `deploy.sh` remains available for
manual publishing. No Actions integration is necessary.

## Secrets and configuration

Configure both secrets on the Edge app:

| Name | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Fine-grained PAT for this repository, with Contents write permission |
| `OPENAI_API_KEY` | OpenAI API access for source generation |

The GitHub token does not need Actions permission.
The token identity must have permission to create the claim tags and commit
directly to `main`. Existing branch protection still applies.

`OPENAI_MODEL` selects the model. `app.yaml` sets `gpt-6-astra`.
`JS_COMMAND` sets the JavaScript executable. The deployed default is `/bin/node`.
The coordinator needs no Wasmer deployment token after installation.

## Local checks

From the repository root, run:

```bash
python3 -m unittest discover -s automation/daily-game/test -v
```

The tests use mock GitHub and model APIs and local Node subprocesses.
They do not create remote commits or incur model usage.

## Activation

The implementation is local and inactive. The WASIX command path and
subprocess behavior still require a runtime check before activation.

1. Commit the automation files to `main`.
2. Make sure that `wasmer whoami` reports `registry wasmer.io`.
3. From `automation/daily-game`, run the packaged runtime check:

   ```bash
   wasmer run . --net -- /app/preflight.py
   ```

   This command must pass before deployment. It checks the child JavaScript
   runtime and outbound HTTPS without credentials or repository writes.

4. Deploy the coordinator:

   ```bash
   wasmer deploy --non-interactive --owner wasmer
   ```

5. Add both secrets through the Wasmer dashboard, then redeploy.
6. Read the actual URL with `wasmer app get -f json`.
7. Make sure that `/healthz` returns HTTP 200.
8. Make sure that the app has exactly one scheduled `daily-game` job.

For a manual first run, use the Edge shell:

```bash
wasmer ssh -a wasmer/multiplayer-game-cron
python /app/preflight.py
python /app/cron.py
```

The last command generates source and pushes a real commit to `main`.
Never paste secret values into chat or commit them.

## Failures and retries

The date claim is `refs/tags/daily-game-claims/YYYY-MM-DD`.
A second invocation cannot claim the same date. A completed date also has
a record under `automation/daily-game/runs/` and returns without generation.

A failed run leaves its claim for diagnosis. Before retrying, make sure
that the previous invocation stopped and that no completion record exists.
Then delete that date's claim tag through GitHub and run the Edge job again.
The retry uses the current UTC date. Missed dates do not receive catch-up runs.

If `main` changes during generation, the job stops without pushing its candidate.
The final ref update always sets `force: false`.
Network errors around that update can leave an ambiguous result. The completion
record on `main` is the source of truth before any retry.

Cron stdout records the date, attempt count, and final commit SHA.
Read invocation status and logs through the Wasmer GraphQL API described
in the Wasmer Edge skill. Failure messages do not print API response bodies.

To stop future generation, remove `jobs` from this app's configuration
and redeploy it. Make sure that no later invocations appear.

## References

- [Wasmer jobs](https://docs.wasmer.io/edge/configuration/jobs/)
- [Embedded Edge.js package](https://github.com/wasmerio/edgejs/blob/main/quickjs-wasm/wasmer.toml)
- [Structured model output](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Background model requests](https://developers.openai.com/api/docs/guides/background)
- [GitHub Git references](https://docs.github.com/en/rest/git/refs)
