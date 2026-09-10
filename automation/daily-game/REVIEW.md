# Independent harness review

An independent review agent inspected the daily-game harness and its tests.
The review covered correctness, recovery, process limits, and maintainability.
It excluded generated gameplay, dependencies, and production deployment.

## Findings and resolutions

| Finding | Resolution | Regression coverage |
|---|---|---|
| P1: Generated tests can change source after validation. Preview commits can differ from the tested worktree. | Compare repository snapshots after checks. Rebuild the index and compare every staged object with checked source bytes. | Actual mutating scenario, staged-only edit, preview mutation, and Git attribute conversion in disposable Git repositories. |
| P1: Child processes can keep output pipes open after Bash times out. | Close inherited pipes during cancellation. Stop Pi on a Bash timeout so generation cannot continue. | Child-process timeout, active cancellation, fatal timeout notification, and supervised-command deadline. |
| Lower priority: Generated tests can produce unbounded output. | Cap combined test output at 2 MiB and stop the command after 60 seconds. | Excessive stdout and inherited-pipe timeout. |

The maintenance cleanup also removed coupling between the production job and its diagnostic probe.
Both now use `processes.py`. The unused GitHub file accessor was removed.

## Follow-up review

The independent agent reviewed the fixes and found no remaining must-fix issue.
Run the complete Wasmer suite with the command in [README.md](README.md#verification).

## Validation results

- Wasmer: all 17 Python tests and all three JavaScript runtime scripts passed.
- Native: 13 Python tests and all three JavaScript scripts passed. Four Git integration tests run only inside Wasmer.
- The reviewed WebC package replayed the saved Meteor Market patch through a fresh clone, validation, and staged-object checks.
- All five game scenarios passed again. This replay made no model request or remote write.

## Remaining boundaries

The agent and coordinator share one Wasmer guest. File checks are not an isolation boundary against hostile code.
Cancellation kills the immediate child and closes its pipes. It does not implement process-group termination.
A Bash timeout fails the invocation instead of allowing Pi to continue.
HTTP checks, real-browser gameplay, and Edge deployment remain separate acceptance steps.
