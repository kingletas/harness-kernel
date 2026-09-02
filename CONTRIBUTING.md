# Contributing

Thanks for looking. This is a small kernel with one hard constraint, and that constraint is the point of the package rather than an obstacle to work around.

## The one promise

**The kernel knows nothing about any target.** It is handed a registry and a workspace and reaches for neither. The test for whether something belongs here is whether it would still make sense if a third target arrived that resembled neither of the two that exist — a CLI, a queue consumer, a mobile app. Percentiles belong. Add-to-cart does not.

A pull request that teaches the kernel about a particular kind of target is almost always a change to the wrong package: the behaviour belongs in the harness that owns that target, reached through `Capabilities` or through a check of its own.

## Setting up

Node 20.19 or newer — `.nvmrc` pins the version this is developed against.

```bash
make setup
```

## Running the checks

```bash
make check
```

That is the build, eslint, prettier and the unit suite, and it is exactly what the pre-commit hook runs. All four must be clean.

```bash
make selfcheck-loud
```

The quiet suite proves the kernel agrees with itself. This one proves the alarm fires: it drives the kernel against a stub target that can be told to carry a defect — a read surface answering a caller with no credentials, a route that fails once and then works, a target refusing connections — and asserts each produces a **non-zero exit that names itself**, and that the healthy target produces **no output at all**.

A green run proves nothing about the alarm, and a firing alarm proves nothing about the quiet. Both directions, every time.

## The ideas worth knowing before you write

- **Eight verdicts, ordered least to most severe, and aggregation takes the maximum.** `pass`, `skipped`, `unsupported`, `quarantined`, `flaky`, `degraded`, `blocked`, `fail`. Pass and fail alone is how a suite becomes noise. A check that cannot mean anything against a target reports `unsupported` and names the missing capability — it never fails, and it is never silently absent from the summary.
- **Only a pass may be silent.** Every other verdict states a reason; `requiresReason` is not advisory.
- **`flaky` and `quarantined` are statements about the suite, not about the target**, so neither turns a run red. `degraded` is policy and defaults to amber.
- **A capability is declared by the target, and `isDisposable` by the environment.** Nothing is available until a target says otherwise — `NO_CAPABILITIES` is the floor. A suite never declares that it may write destructively to something.
- **The console says nothing** when the run is green and its known exceptions are unchanged. Anything new that emits needs an answer to what it is silent for.
- **Five ledgers**: the signature, the measurement baseline, the drift ledger, the flake ledger and the quarantine list. A change to what any of them records is a change to what a diff means to a reviewer, so say so in the pull request.
- **Comments say what the code does or what it guards against**, in a sentence or two. History belongs in the commit message and the changelog.

## How the code is arranged

- `src/kernel/` — the run, the verdicts, the worker pool and its circuit breaker, capabilities, retry, seeding, selection, preflight. Where most changes belong.
- `src/history/` — the five ledgers and the signature.
- `src/reporting/` — the console, JSON and matrix reporters, and percentiles.
- `src/cli/` — `runCli` and the eight commands a harness gets for free. A tool adds its own through the third argument rather than by editing a switch.
- `src/targets/`, `src/surfaces/` — the registry and target contract, and the HTTP surface.
- `selfcheck/`, `fixtures/` — the stub target and the checks that drive it.

## Sending a change

- One concern per pull request, with the reasoning in the description.
- `make check` green, and `make selfcheck-loud` green if you touched the runner, the verdicts or the reporters.
- A test with the fix, and for anything that changes what is emitted, a test for the quiet case as well as the loud one.
- Update `CHANGELOG.md` under a new heading, in the voice of the entries already there: what changed for someone using it, not what the diff did.

## Security

Please do not open a public issue for a vulnerability. [SECURITY.md](SECURITY.md) has the model and the reporting route.
