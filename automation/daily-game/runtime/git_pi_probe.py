"""Runtime proof for clone -> Pi edit/test -> git commit/push."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def execute(args, cwd, env, timeout=60):
    operation = args[3] if len(args) > 3 and args[1:3] == ["-c", "core.hooksPath=/dev/null"] else args[1]
    print(f"RUN {Path(args[0]).name} {operation}", flush=True)
    previous = os.getcwd()
    try:
        os.chdir(cwd)
        result = subprocess.run(args, env=env, capture_output=True,
                                text=True, timeout=timeout, check=False)
    finally:
        os.chdir(previous)
    if result.returncode:
        detail = result.stderr.strip()
        for key, value in env.items():
            if value and any(word in key.upper() for word in ("KEY", "TOKEN", "SECRET", "PASSWORD")):
                detail = detail.replace(value, "[REDACTED]")
        raise RuntimeError(f"{Path(args[0]).name} failed with exit code {result.returncode}: {detail[-4000:]}")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--git", default="git")
    parser.add_argument("--node", default="node")
    parser.add_argument("--bash", default="bash")
    parser.add_argument("--pi-cli", required=True)
    parser.add_argument("--agent", action="store_true", help="Run Pi with the model API")
    parser.add_argument("--provider", default="openai")
    parser.add_argument("--model", default="gpt-6-astra")
    args = parser.parse_args()
    for name in ("git", "node", "bash"):
        executable = shutil.which(getattr(args, name))
        if executable is None:
            raise RuntimeError(f"Missing executable: {name}")
        setattr(args, name, executable)
    args.pi_cli = str(Path(args.pi_cli).resolve(strict=True))
    api_key = os.environ.get("OPENAI_API_KEY")
    if args.agent and (args.provider != "openai" or not api_key):
        raise RuntimeError("The agent probe requires provider openai and OPENAI_API_KEY")

    # The guest filesystem is discarded on exit; WASIX can reject Git tree cleanup.
    with tempfile.TemporaryDirectory(prefix="edge-git-pi-", ignore_cleanup_errors=True) as temp:
        folder = Path(temp)
        agent_home = folder / "home"
        agent_home.mkdir()
        paths = list(dict.fromkeys(str(Path(command).parent) for command in (args.git, args.node, args.bash)))
        env = {"PATH": ":".join(paths + ["/bin", "/usr/bin"]), "TMPDIR": temp,
               "HOME": str(agent_home),
               "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
               "GIT_TERMINAL_PROMPT": "0", "GIT_AUTHOR_NAME": "Edge runtime probe",
               "GIT_AUTHOR_EMAIL": "edge-probe@example.invalid",
               "GIT_COMMITTER_NAME": "Edge runtime probe", "GIT_COMMITTER_EMAIL": "edge-probe@example.invalid",
               "PI_CODING_AGENT_DIR": str(folder / "pi-state")}
        for key in ("GIT_SSL_CAINFO", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"):
            if key in os.environ:
                env[key] = os.environ[key]
        def git(*words, cwd=folder):
            return execute([args.git, "-c", "core.hooksPath=/dev/null", *words], cwd, env)

        print("Git:", git("--version"), flush=True)
        print("JavaScript:", execute([args.node, "--version"], folder, env), flush=True)
        execute([args.bash, "-c", 'test "$(printf probe)" = probe'], folder, env)
        print("Pi:", execute([args.node, args.pi_cli, "--version"], folder, env), flush=True)

        git("clone", "--depth=1", "--single-branch", "--branch=main",
            "https://github.com/wasmerio/edge-multiplayer-games.git", "reference")
        assert (folder / "reference/AGENTS.md").is_file()
        print("PASS HTTPS clone of the game repository", flush=True)

        git("init", "--bare", "--initial-branch=main", "remote.git")
        git("init", "--initial-branch=main", "seed")
        seed = folder / "seed"
        (seed / "package.json").write_text('{"type":"module"}\n')
        (seed / "sum.js").write_text('export const sum = (a, b) => a - b;\n')
        test_source = (
            'import assert from "node:assert/strict";\n'
            'import {sum} from "./sum.js";\n'
            'assert.equal(sum(2, 3), 5);\n'
            'assert.equal(sum(-2, 3), 1);\n'
            'console.log("PROBE_TEST_PASS");\n')
        (seed / "test.mjs").write_text(test_source)
        git("add", "package.json", "sum.js", "test.mjs", cwd=seed)
        git("commit", "-m", "Seed isolated runtime probe", cwd=seed)
        git("remote", "add", "origin", str(folder / "remote.git"), cwd=seed)
        git("push", "origin", "HEAD:main", cwd=seed)
        git("clone", str(folder / "remote.git"), "work")
        work = folder / "work"
        original = git("rev-parse", "HEAD", cwd=work)

        if args.agent:
            agent_env = {**env, "OPENAI_API_KEY": api_key}
            system = Path(__file__).with_name("pi-probe-system.md").read_text()
            prompt = ("INPUT\nWork directory: " + str(work)
                      + "\nFailing check: node test.mjs\nEditable file: sum.js\n")
            output = execute([args.node, args.pi_cli, "--print", "--mode", "json", "--no-session",
                              "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
                              "--provider", args.provider, "--model", args.model,
                              "--append-system-prompt", system, prompt], work, agent_env, timeout=300)
            events = [json.loads(line) for line in output.splitlines() if line.strip()]
            bash_events = [event for event in events if event.get("type") == "tool_execution_start"
                           and event.get("toolName") == "bash"]
            assert bash_events, "Pi did not exercise its Bash tool"
            print("PASS Pi model request and Bash tool invocation", flush=True)
        else:
            (work / "sum.js").write_text('export const sum = (a, b) => a + b;\n')
            print("SKIP model edit: use --agent for the full Pi proof", flush=True)

        assert git("rev-parse", "HEAD", cwd=work) == original, "Pi unexpectedly committed"
        assert git("status", "--porcelain", cwd=work).strip() == "M sum.js", "Unexpected file changes"
        assert (work / "test.mjs").read_text() == test_source, "The probe test changed"
        assert execute([args.node, "test.mjs"], work, env) == "PROBE_TEST_PASS"
        git("add", "sum.js", cwd=work)
        git("commit", "-m", "Verify agent edit and test", cwd=work)
        git("push", "origin", "HEAD:main", cwd=work)
        expected = git("rev-parse", "HEAD", cwd=work)
        assert git("--git-dir=" + str(folder / "remote.git"), "rev-parse", "refs/heads/main") == expected
        git("clone", str(folder / "remote.git"), "verification")
        assert execute([args.node, "test.mjs"], folder / "verification", env) == "PROBE_TEST_PASS"
        print("PASS commit, push, and independent checkout verification against disposable local Git remote", flush=True)
        print("Remote HTTPS push authentication and Wasmer Edge deployment require separate checks", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, AssertionError, subprocess.TimeoutExpired, ValueError) as error:
        raise SystemExit(f"Runtime probe failed: {type(error).__name__}: {error}") from None
