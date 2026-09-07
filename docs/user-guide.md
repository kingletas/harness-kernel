# User guide

Every command and flag your harness gets from the kernel, and what each of the eight verdicts means. You didn't write any of this and you can't break it from a target.

## Contents

- [The commands](#the-commands)
- [The flags](#the-flags)
- [The eight verdicts](#the-eight-verdicts)
- [Reading a run](#reading-a-run)
- [Why a healthy run says nothing](#why-a-healthy-run-says-nothing)
- [When the target dies](#when-the-target-dies)
- [Flaky checks](#flaky-checks)
- [Quarantine](#quarantine)
- [Running only what changed](#running-only-what-changed)
- [Notifications](#notifications)
- [Schedules](#schedules)
- [Exit codes](#exit-codes)

## The commands

| Command                            | What it does                                                     |
| ---------------------------------- | ---------------------------------------------------------------- |
| `run --target <name>`              | Run the checks and give a verdict                                |
| `selfcheck`                        | Prove the harness against the kernel's own stub                  |
| `targets`                          | List the targets and the suites each offers                      |
| `coverage [--target <name>]`       | Check the sign-off sheet against the checks filling it           |
| `probe --target <name>`            | Report whether the suite could drive the target, judging nothing |
| `plan --target <name> [--changed]` | Say what a run would do, and do none of it                       |
| `quarantine [add <id>]`            | List what's held out of the verdict, and put something there     |
| `flakes [--target <name>]`         | Checks whose recent history is inconsistent                      |
| `flakes --forget <id>`             | Drop one check's history                                         |
| `notify --test`                    | Send one message, to prove the channel works                     |
| `schedule plan\|install\|report`   | The systemd units a schedule needs                               |
| `help`                             | The usage block                                                  |

## The flags

| Flag              | What it decides                                                   |
| ----------------- | ----------------------------------------------------------------- |
| `--target <name>` | Which target to ask                                               |
| `--suite <a,b>`   | Which suites to run. Default: all of them                         |
| `--url <url>`     | Override the target's base URL                                    |
| `--env <name>`    | The environment label recorded on the run. Default `local`        |
| `--seed <value>`  | Replay the random choices an earlier run made                     |
| `--workers <n>`   | How many checks may be in flight at once. Default 1               |
| `--verbose`       | Report every check, not only what changed                         |
| `--matrix`        | Print the sign-off sheet after the run                            |
| `--strict`        | A timing well outside its usual range fails the run               |
| `--changed`       | Run only what a diff in the target's own repository put at risk   |
| `--since <ref>`   | What to compare against. Default `HEAD`, meaning uncommitted work |
| `--no-record`     | Teach nothing, and tell nobody                                    |
| `--no-notify`     | Tell nobody, whatever `HARNESS_NOTIFY` says                       |
| `--notify`        | Tell the channel even from a command that normally wouldn't       |
| `--defect <name>` | `selfcheck` only: arrange a fault in the stub                     |

**`--workers` above 1 won't judge or record timings.** A number taken while three other checks are hammering the same target isn't comparable with one taken on its own, so we'd rather say nothing than quietly record a slower number as a regression. That's why one at a time is the default.

**`--no-record` implies `--no-notify`.** A run that teaches nothing tells nobody either — an arranged experiment that pages somebody is indistinguishable from a real failure.

**Every check's random choices come from the run seed combined with its own id**, so `--workers 4` and `--workers 1` make the same choices and `--seed` replays them.

## The eight verdicts

Ordered least to most severe. A run's verdict is the worst one in it.

| Verdict       | It means                                                            | Red?                 |
| ------------- | ------------------------------------------------------------------- | -------------------- |
| `pass`        | It did what it should                                               |                      |
| `skipped`     | It wasn't selected for this run                                     |                      |
| `unsupported` | It can't mean anything here, and it names what's missing            |                      |
| `quarantined` | You've held it out of the verdict on purpose                        |                      |
| `flaky`       | Its recent history is inconsistent, so its answer isn't trustworthy |                      |
| `degraded`    | It passed, slower than it usually is                                | only with `--strict` |
| `blocked`     | It couldn't get far enough to have an opinion                       | **yes**              |
| `fail`        | It didn't do what it should                                         | **yes**              |

**Only a pass may be silent.** Every other verdict has to carry a reason, and the kernel refuses one that doesn't.

`flaky` and `quarantined` don't turn a run red because they're statements about your suite rather than about your target. If they did, the harness's own uncertainty would read as your software being broken.

## Reading a run

```text
pingbot site/local — smoke
  run 20260907T130909Z-5df640d1   seed 5df640d1   build unknown

  FAIL  site.about
        assertion: /about answered 404, not 200
        status: 404

  3 checks — 2 pass, 1 fail
```

The run id is also the directory it wrote. The seed replays it. `build` is whatever the target said it was at preflight. The indented line under the reason is evidence a check recorded, kept because that one didn't pass.

**Preflight counts as a check**, which is why two declared checks come out as three.

Every run writes a directory under `results/`: `journal.jsonl` (one line per thing that happened), `report.json` (the whole run, for a machine), `matrix.csv` and `matrix.json` (the sign-off sheet), and `artefacts/` for anything a check kept.

## Why a healthy run says nothing

A run that says nothing found nothing wrong, and it exits 0.

A check that talks when nothing's wrong teaches you to stop reading it. Then, when it finally has something real to say, you scroll past that too. So the console stays quiet while the outcome is unchanged, and speaks up when it isn't. `--verbose` overrides that when you want the whole list.

## When the target dies

After three failures to reach it with nothing getting through in between, the circuit opens and every remaining check reports `blocked` at once. You get one sentence about the target being unreachable instead of one timeout per check.

"Consecutive" means _with nothing reaching the target in between_, which is what keeps it meaningful once checks interleave under `--workers`.

## Flaky checks

```bash
yourharness flakes --target yours
```

A check that passes, then fails, then passes again with nothing changing is worse than one that always fails: it teaches you to rerun until it goes green. The kernel keeps a history and reports `flaky` when one is inconsistent.

**A check that passes only on a retry is reported `flaky` for that run too.** That's the one thing the run learned about your suite, and calling it green throws it away.

```bash
yourharness flakes --forget site.home
```

## Quarantine

```bash
yourharness quarantine add site.about
```

A quarantined check still runs and still reports. It doesn't turn the run red, and it shows up every time you ask — so it stays a decision you keep making rather than one you made once and forgot. It lives in `ledger/`, which is committed, so putting one there is a diff somebody has to approve.

## Running only what changed

If your target says where its own source lives and what a change to each path puts at risk, the kernel can narrow a run from a diff.

```bash
yourharness plan --target yours --changed
```

`plan` says what it would run and runs nothing. **A path matching no rule falls back to running everything** — a narrowing rule that guesses wrong silently drops the checks that would have caught the thing.

## Notifications

Off unless the environment asks for it.

```bash
export HARNESS_NOTIFY=webhook
export HARNESS_NOTIFY_WEBHOOK=https://chat.example/hooks/xxxx
```

```bash
yourharness notify --test
```

**It sends when there's something to say, which is stricter than when something is red.** A run is boiled down to a story: this check, failing, for this reason.

A story the channel hasn't carried yet is sent. One it has already carried backs off — the wait doubles each time, up to thirty-two runs — so a failure that lasts a month is mentioned about once a month rather than sixty times a day or never again after the first.

A recovery has to hold for two runs before it's sent. A check that fails, passes once and fails again hasn't recovered.

## Schedules

```bash
yourharness schedule plan --target yours
```

Will show you what you'd need to configure as a systemd timer, and writes nothing.

```bash
yourharness schedule install --target yours
```

This writes it but doesn't enable it — we defer enabling anything to you, with `systemctl`.

```bash
yourharness schedule report --days 7
```

What your schedules have actually been doing. That's a different question from whether a timer is enabled, and usually the more useful one.

While a run is in flight it holds a lock, so a schedule can't start a second run of the same target on top of the first. A lock left by a process that's gone is taken over rather than obeyed forever.

## Exit codes

| Code | Means                                                                      |
| ---- | -------------------------------------------------------------------------- |
| `0`  | Nothing red                                                                |
| `1`  | A check failed, or the target couldn't be reached                          |
| `2`  | The command or its arguments were wrong                                    |
| `3`  | The run finished and the channel couldn't be told. The verdict is above it |

`3` has its own code because the run is still valid. Losing the message isn't the same as losing the answer.
