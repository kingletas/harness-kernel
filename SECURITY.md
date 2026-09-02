# Security

## Model

This is a test kernel. It is pointed at a system somebody wants to check, drives it, and writes down what happened. Two things follow from that, and both matter more than they look.

**Everything the target returns is attacker-controlled.** A harness is routinely pointed at a staging environment, a preview deploy, or a store whose configuration is not the operator's to fix. Responses, error banners, page titles and headers all reach the reporters and the ledgers as text. The kernel never evaluates any of it, never renders it, and never uses it to choose a code path — a response decides a verdict, never a control flow.

**A run's artefacts carry whatever the target sent.** Traces, HAR files, videos and screenshots are recorded by whatever surface a harness plugs in, and the kernel does not redact them. A HAR from an authenticated journey contains session cookies and bearer tokens; a video contains whatever was on the page. So:

- `results/` is per-run, and is **never committed** — the shipped `.gitignore` excludes it, and a harness built on this kernel should keep it that way.
- **Do not attach a raw artefact to a public issue.** Attach the console output, which carries verdicts and reasons rather than payloads.
- The `ArtefactStore` enforces a shared byte budget, not a privacy boundary. It stops a run filling a disk. It does not make the contents safe to publish.

**The kernel holds no credentials.** It has no configuration file, no keyring, and no environment variables of its own. Whatever a target needs to authenticate is the harness's to supply and the harness's to keep out of its logs.

**Writes stay inside the workspace.** A `Workspace` is rooted at a directory the caller resolved and passed in; the kernel joins beneath it and counts no path of its own. Nothing is written outside `ledger/`, `baselines/` and `results/`. A harness that hands over a root it does not control has already lost that guarantee.

**A destructive run is declared by the environment, never by a suite.** `isDisposable` is a capability a target reports, and a check that would write destructively refuses where it is false. This is the control that keeps a suite off production, and a change that lets a check assert its own disposability is a security change rather than a convenience.

**Zero runtime dependencies.** The package installs nothing at runtime, so its supply-chain surface is Node itself. The development dependencies are the usual TypeScript toolchain and are locked.

## Reporting a vulnerability

Email **code@kingletas.com** with a description and, ideally, a minimal target stub that reproduces the issue — `selfcheck/` and `fixtures/stub-target.ts` are the shape to copy. You will get an acknowledgment, a triage verdict, and, for confirmed issues, a fix accompanied by a regression test and a sweep for the rest of the defect's class.
