# Run the Git and Pi probe with Wasmer

The package has a `probe` command for the proposed Edge runtime.
It uses packaged Python, Git, Bash, Edge.js, and Pi.
It does not call host Git, Bash, or Node.

This is a compatibility test. The daily game job still uses the earlier,
inactive generator. The clone-and-Pi job is not ready for deployment.

## Prepare the package

From the repository root:

```bash
cd automation/daily-game
npm ci --prefix pi --ignore-scripts --no-bin-links --no-audit --no-fund
npm run --prefix pi prepare:wasmer
```

Host npm installs the pinned Pi files before packaging.
The `/pi` filesystem mapping includes them in the Wasmer package.
Pi does not need npm installation during a cron invocation.
Keep `--no-bin-links`: it avoids symlinks that the packager can reject.
The preparation step converts six Unicode-set expressions to Unicode-mode
expressions with `regexpu-core`. It checks sample matches against native Node.
Run preparation again after every `npm ci`.

The manifest pins Python package 3.13.18, Git 2.52.0, Bash 1.0.25,
Edge.js 0.2.0, and Pi 0.85.1. Runtime package metadata was checked
against the public registry.
The probe starts Edge.js before Python. Wasmer 7.3.0 enables the Wasm C API
imports when the entry module needs them. Starting Python first leaves
those imports unavailable to an Edge.js child process.

## Run without a model request

From `automation/daily-game`:

```bash
wasmer run . -e probe --net
```

The first run downloads and compiles the Wasm dependencies.
The command checks these operations:

1. Start packaged Git, Bash, Edge.js, and Pi.
2. Clone this repository from GitHub over HTTPS.
3. Create a disposable local Git remote and a fixture with a failing test.
4. Apply a fixed edit without requesting a model response.
5. Run the unchanged JavaScript test.
6. Commit and push to the disposable local remote.
7. Clone that remote again and repeat the test.

Expect `PASS HTTPS clone of the game repository`, followed by the final
`PASS commit, push, and independent checkout verification` message.
This mode also prints `SKIP model edit`.

## Run the Pi agent

Set `OPENAI_API_KEY` in your shell first. Then run:

```bash
wasmer run . -e probe --net \
  --env "OPENAI_API_KEY=${OPENAI_API_KEY:?Set OPENAI_API_KEY first}" \
  -- --agent --model gpt-6-astra
```

This mode makes a billable model request. Pi must fix the fixture and use
its Bash tool. The outer probe then checks, commits, pushes, and verifies
an independent checkout. It also requires this message:

```text
PASS Pi model request and Bash tool invocation
```

The probe forwards the model key only to Pi. Other child processes receive
an explicit environment without that key. Do not commit or share the key.

Both modes use disposable repositories inside Wasmer.
They do not change the real repository's `main` or require a GitHub write token.
A local push does not test authenticated HTTPS push to GitHub.
That requires a separate remote test branch and credential.

## Test a built artifact

You can build once and run the same artifact repeatedly:

```bash
wasmer package build -o /tmp/multiplayer-game-cron.webc
wasmer run /tmp/multiplayer-game-cron.webc -e probe --net
```

Use the same `--env` and `-- --agent` options for the model test.
The Edge cron must eventually use this package and the production job command.
Local execution does not test Edge scheduling, secrets, or execution limits.

## Diagnose a failure

The probe prints the executable before each child process starts.
A failed process reports its exit code and the last part of stderr.
Known secret values are removed from that diagnostic output.

To isolate startup failures, run:

```bash
wasmer run . -e git --net -- --version
wasmer run . -e bash -- -c 'printf "BASH_OK\n"'
wasmer run . -e node -- --version
wasmer run . -e node --env HOME=/tmp -- /pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js --version
```

If registry lookup fails, check `wasmer whoami` for `registry wasmer.io`.
The Git package is `kilyanni/git`, not `git/git` or `wasmer/git`.
Do not replace the packaged executable with host Git to make the test pass.

The local command-policy exception now permits Wasmer execution.
The complete probe without model access passed with Wasmer 7.3.0 on
2026-09-10, with exit code 0. This includes Pi startup, HTTPS cloning,
JavaScript tests, Git commits, pushes, and an independent checkout.
WebC package building and the same probe from the built artifact also passed.

The model-backed test requires explicit approval to use the OpenAI key.
Authenticated GitHub pushes and actual Edge invocations remain unverified.

Python's WASIX subprocess implementation does not support `cwd`.
The coordinator changes its working directory before each subprocess and
restores it afterward. The probe is single-threaded.
It tolerates Git-tree cleanup errors because Wasmer discards the guest
filesystem when the process exits.

## Checks before activation

- Both local modes pass with the packaged runtimes.
- Git pushes to a designated remote test branch using an Edge secret.
- The same probe passes in an actual Edge job invocation.
- The daily coordinator uses Git clone, Pi, validation, and a non-forced push.
- The coordinator prevents duplicate games for one UTC date.
- Generated games satisfy the repository's checks before publication.

Sources: [Git package](https://wasmer.io/kilyanni/git),
[Bash package](https://wasmer.io/wasmer/bash),
[Edge.js package](https://wasmer.io/wasmer/edgejs-quickjs),
and [Pi package metadata](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json).
