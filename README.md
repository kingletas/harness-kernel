# @harness/kernel

A test kernel that knows nothing about any target.

Everything here would still make sense if a third target arrived that was
neither of the two that exist — a CLI, a queue consumer, a mobile app. The test
for whether something belongs is exactly that: percentiles belong, add-to-cart
does not.

```bash
make check
```

```bash
make selfcheck-loud
```

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

## Proving it

`make selfcheck-loud` drives the kernel against a stub target that can be told
to carry a defect — a read surface that answers a caller with no credentials, a
route that fails once and then works, a target that refuses connections — and
asserts that each produces a non-zero exit and names itself, **and** that the
healthy target produces no output at all.

A green run proves nothing about the alarm, and a firing alarm proves nothing
about the quiet.
