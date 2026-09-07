# Configuration

There's no configuration file. What the kernel needs from outside is five environment variables, and everything else is decided by the harness that embeds it — in code, where it can be reviewed.

## Contents

- [The notification channel](#the-notification-channel)
- [What your harness decides, not the environment](#what-your-harness-decides-not-the-environment)
- [The workspace](#the-workspace)
- [What to commit, and why](#what-to-commit-and-why)
- [Turning all of it off for one run](#turning-all-of-it-off-for-one-run)

## The notification channel

These are the only environment variables the kernel reads.

| Variable                 | What it decides                                             |
| ------------------------ | ----------------------------------------------------------- |
| `HARNESS_NOTIFY`         | `none` (default), `mail` or `webhook`                       |
| `HARNESS_NOTIFY_SMTP`    | mail: `host:port` of the sink                               |
| `HARNESS_NOTIFY_TO`      | mail: who's told                                            |
| `HARNESS_NOTIFY_FROM`    | mail: who it claims to be from. Default `harness@localhost` |
| `HARNESS_NOTIFY_WEBHOOK` | webhook: the incoming-webhook URL                           |

A half-configured channel is refused in seconds, before the suite runs, with a sentence saying what's missing — a mail channel with nobody to deliver to says so rather than running everything and failing at the end.

```bash
yourharness notify --test
```

> [!WARNING]
> **`HARNESS_NOTIFY_WEBHOOK` is a credential.** Anything holding it can post to that channel. `HARNESS_NOTIFY_SMTP` may name an internal host. Neither belongs in a shell history, a CI log, or a committed file.

## What your harness decides, not the environment

Everything else is code, and that's deliberate — a setting in a file is a decision nobody reviews.

| Decided in your harness                    | Where                                               |
| ------------------------------------------ | --------------------------------------------------- |
| What your command is called                | the `Harness` you build                             |
| Which targets exist                        | `registryOf({ … })`                                 |
| Where anything is written                  | `workspaceAt(root)`                                 |
| Which base URL a target uses               | your target factory, usually from your own variable |
| What may be asked of a target              | the target's `capabilities`                         |
| How many attempts a failure class is worth | `retryPolicy({ … })`, or `NO_RETRY` on one check    |

**`isDisposable` is the one capability that should come from the environment.** It means _this particular target may be written to destructively_, and only the person pointing the harness somewhere can answer that. A suite that decides its own disposability has decided it for every target it's ever run against.

## The workspace

`workspaceAt(root)` gives four directories under whatever root you hand it. Each harness owns its own — a shared directory would put two harnesses' ledgers in one namespace.

| Directory         | What's in it                                                            |
| ----------------- | ----------------------------------------------------------------------- |
| `ledger/`         | The quarantine list, the drift record, the flake history                |
| `baselines/`      | What wasn't green last time, per environment, and the timings           |
| `results/`        | One directory per run: the journal, the report, the sheet, any evidence |
| `results/.locks/` | One file per target while a run is in flight                            |

**Nothing counts its own depth to find that root except the one module you write.** Depth is a property of where a file sits, so any module that works it out for itself gets silently repointed the day somebody moves it. Resolve it once and pass the workspace around.

## What to commit, and why

Three answers, and the difference between them isn't tidiness.

**Commit `ledger/`.** What's quarantined, how selectors have drifted and which checks are inconsistent are facts about your software, identical on every machine. Putting them under review means a check going permanently held-out shows up as a diff somebody has to approve, rather than as a quiet change on one laptop.

**Commit the signature in `baselines/`, not the timings.** The signature is what wasn't green last time, which is what lets a run say _this changed_. A measurement is a fact about the machine that produced it, so a laptop's history judging a CI runner's numbers reports a regression that's only a change of hardware. Ignore `baselines/*.measurements.json`.

**Don't commit the record of who's been told.** It says what the person on the other end of the channel currently believes, on this machine. A committed copy would let one person's channel decide whether another person's run says anything.

**Don't commit `results/`.** A run's evidence can carry whatever the target sent — page dumps, traces, cookies — and nothing redacts it.

## Turning all of it off for one run

```bash
yourharness run --target yours --no-record
```

It records nothing — not what wasn't green, not the timings, not the drift or flake history — and it says so in its own output, so a teaching run and a non-teaching one can never be mistaken for each other. It tells nobody either.

The run's own journal and report are still written. They're this run's, and no later run reads them.
