# harness-kernel

A test kernel that knows nothing about any target.

Everything here would still make sense if a third target arrived that was
neither of the two that exist — a CLI, a queue consumer, a mobile app. The test
for whether something belongs is exactly that: percentiles belong, add-to-cart
does not.

## Installing it

Not on npm. Depend on the repository:

```bash
npm install github:kingletas/harness-kernel
```

It has **no runtime dependencies** and builds itself on install, so the only thing it brings with it is Node.

## Checking it

```bash
make check
```

The build, eslint, prettier and the unit suite — what the pre-commit hook runs.

```bash
make selfcheck-loud
```

The other direction. [Proving it](#proving-it), below, is what that means.

## What a harness gets

- **A run**: an id, a seed every check derives its own stream from, and a build
  stamped at preflight so a result three weeks old is still attributable.
- **Eight verdicts**, because pass and fail is how a suite becomes noise. A
  check that cannot mean anything against a target reports `unsupported` and
  names the missing capability; it never fails and is never silently absent.
- **A worker pool with a declared width**, and a circuit breaker whose
  _consecutive_ means "with nothing reaching the target in between" so it still
  means something once checks interleave.
- **Five ledgers** — the signature, the measurement baseline, the drift ledger,
  the flake ledger and the quarantine list — and one flag that spares all of
  them.
- **A console that says nothing** when the run is green and its known exceptions
  are unchanged.
- **One run at a time per target**, and a lock that a crashed run cannot leave
  jamming every run after it.
- **A channel that says nothing either** — mail or an incoming webhook, carrying
  the console's own text, backing off a story it has already told and refusing
  to call a recovery until it has held.

## What a harness must provide

A `Registry` of targets and a `Workspace` to write into. The kernel is handed
both and reaches for neither, which is what stops two harnesses sharing a ledger
by accident.

```ts
const harness: Harness = {
	name: 'drexbot',
	registry: registryOf({ magento: magentoTarget }),
	workspace: WORKSPACE,
}

process.exitCode = await runCli(harness, process.argv.slice(2))
```

`runCli` brings `run`, `selfcheck`, `targets`, `coverage`, `plan`, `probe`,
`quarantine` and `flakes`. A tool adds its own with the third argument rather
than by editing a switch.

## Telling somebody

A scheduled run nobody reads is worse than no run, so the kernel can hand a run
to a channel. It is off unless the environment asks for it:

```bash
HARNESS_NOTIFY=mail HARNESS_NOTIFY_SMTP=127.0.0.1:1025 HARNESS_NOTIFY_TO=you@example.test
HARNESS_NOTIFY=webhook HARNESS_NOTIFY_WEBHOOK=https://chat.example/hooks/...
```

`notify --test` sends one message and names where it went. A channel described
wrongly is refused before the first check runs, and a message that could not be
delivered exits **3** and records nothing as sent, so the next run says it again.

The channel is quiet in exactly the cases the console is: a green run whose story
is unchanged reaches nobody. A failure that persists is repeated after 2 runs,
then 4, 8, 16 and 32 — held per story, so two failures taking turns do not reset
each other's schedule — and a recovery is announced only once it has held for two
runs.

## Scheduling it

```bash
<tool> schedule plan --target <name> --every daily     # print the units, write nothing
<tool> schedule install --target <name> --every daily  # write them, enable nothing
<tool> schedule report --days 7                        # what the schedule has been doing
```

`install` writes a systemd user service and timer and prints the commands that
enable them; it never runs those itself. The timer carries `Persistent=true`, so
a window missed while the machine was off runs once it comes back, and the
channel's variables come from an `EnvironmentFile` rather than from the unit.

`report` is the weekly read. The line that matters most is the longest stretch
with no run at all, because a schedule that quietly stopped firing looks exactly
like one with nothing to say.

## Proving it

`make selfcheck-loud` drives the kernel against a stub target that can be told
to carry a defect — a read surface that answers a caller with no credentials, a
route that fails once and then works, a target that refuses connections — and
asserts that each produces a non-zero exit and names itself, **and** that the
healthy target produces no output at all.

A green run proves nothing about the alarm, and a firing alarm proves nothing
about the quiet.

## Built on it

- [drexbot](https://github.com/kingletas/drexbot) — regression, acceptance, behaviour and performance testing for a Magento storefront.

## License

MIT — see [LICENSE](LICENSE). [CONTRIBUTING.md](CONTRIBUTING.md) is the shape a change should arrive in, and [SECURITY.md](SECURITY.md) has the model and the reporting route.
