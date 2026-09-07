# From nothing to your own harness

By the end of this you'll have built a working test harness — your own command, with your own checks, against something you care about — on top of this kernel. It takes about twenty minutes and roughly eighty lines of TypeScript.

You need to be comfortable with TypeScript. You don't need to know anything about this kernel.

## Contents

- [What the kernel is, and what it leaves to you](#what-the-kernel-is-and-what-it-leaves-to-you)
- [Step 1: a project](#step-1-a-project)
- [Step 2: a target](#step-2-a-target)
- [Step 3: your first two checks](#step-3-your-first-two-checks)
- [Step 4: wire up the command](#step-4-wire-up-the-command)
- [Step 5: run it](#step-5-run-it)
- [Step 6: break something](#step-6-break-something)
- [What you get for free](#what-you-get-for-free)
- [Saying a check can't run here](#saying-a-check-cant-run-here)
- [Throwing the right kind of error](#throwing-the-right-kind-of-error)
- [Where your harness keeps things](#where-your-harness-keeps-things)
- [Where to go next](#where-to-go-next)

## What the kernel is, and what it leaves to you

Suppose you want to know, every morning, whether the thing you run still works. You write some checks. Then you discover that writing checks was the easy part.

You need retries — but only for the right failures, because retrying a genuine bug just hides it. You need to stop after the target dies rather than watching forty checks time out one by one. You need to notice the check that passes and fails in turn without anyone changing anything. You need somewhere to keep what happened, so this morning's run can say what's different from yesterday's. You need it to shut up when nothing's wrong, or nobody reads it by Thursday.

That's what's in here. **The kernel does all of that and knows nothing about what you're testing.** You supply the thing it doesn't have: what your target is, and what's worth checking about it.

The dividing line is one question: _would this still make sense for something completely different?_ Percentiles belong here. "Add to cart" doesn't.

## Step 1: a project

Node 20.19 or newer.

```bash
mkdir pingbot && cd pingbot && npm init -y
```

```bash
npm install github:kingletas/harness-kernel
```

It has no runtime dependencies and builds itself on install, so all it brings with it is Node.

```bash
npm install -D typescript @types/node
```

You'll want `"type": "module"` in `package.json`, and a `tsconfig.json` with `"module": "NodeNext"`. The kernel ships as ES modules, so CommonJS won't import it.

> [!NOTE]
> **npm 12 refuses git dependencies by default** and stops with `EALLOWGIT`. If that happens, use `npm install --allow-git=all`, or npm 11, which Node 24 still ships.

## Step 2: a target

A **target** is the thing you're testing, described to the kernel. It answers a handful of questions: what are you called, are you there, what can be asked of you, and what checks apply.

Put this in `src/site.ts`. It's a website, asked for nothing but HTTP.

```ts
import {
	AssertionFailure,
	HttpSurface,
	NO_CAPABILITIES,
	type CheckDefinition,
	type Target,
	type TargetOptions,
} from 'harness-kernel'

export const siteTarget = (options: TargetOptions = {}): Target => {
	const baseUrl = options.baseUrl ?? process.env['SITE_URL'] ?? 'http://127.0.0.1:8099'
	const http = new HttpSurface(baseUrl, 10_000)

	return {
		name: 'site',
		environment: options.environment ?? 'local',
		capabilities: NO_CAPABILITIES,

		async preflight() {
			const response = await http.get('/')
			return {
				reachable: response.status === 200,
				build: 'unknown',
				capabilities: NO_CAPABILITIES,
				...(response.status === 200 ? {} : { problem: `/ answered ${response.status}` }),
			}
		},

		areas: () => [{ id: 'pages', title: 'The pages a visitor needs' }],

		suites: () => new Map([['smoke', []]]),
	}
}
```

Three things in there are worth a sentence each.

**`preflight` runs before any check does, and a target that says it isn't reachable stops the run.** Nothing else runs. A run that can't say what it tested isn't evidence about anything, so the kernel would rather have no answer than a confident wrong one. `build` is whatever your target calls its version — stamp it if you can, so a result you read in three weeks is still attributable.

**`NO_CAPABILITIES` is everything set to false**, and that's the right starting point. Capabilities are how a check says _I need something this target can't offer_. Claiming one you haven't wired up gives you a check that fails for the wrong reason.

**`areas` is your sign-off sheet** — the list of things you mean to cover, written down separately from the checks that cover them. It's separate on purpose: a gap you never declared is indistinguishable from a gap nobody noticed.

## Step 3: your first two checks

A **check** has an id, a title, the suite it belongs to, and a body that throws when something's wrong. Add this above the `return` in `siteTarget`, and put the two checks in the map.

```ts
const answers = (id: string, title: string, path: string): CheckDefinition => ({
	id,
	title,
	suite: 'smoke',
	area: 'pages',
	async body({ record }) {
		const response = await http.get(path)
		record('status', String(response.status))
		if (response.status !== 200) {
			throw new AssertionFailure(`${path} answered ${response.status}, not 200`)
		}
	},
})
```

```ts
suites: () =>
	new Map([
		[
			'smoke',
			[
				answers('site.home', 'The home page answers', '/'),
				answers('site.about', 'The about page answers', '/about'),
			],
		],
	]),
```

**The id is what everything else holds on to** — the flake history, the quarantine list, the sign-off sheet. Keep it stable even when you reword the title.

**`record` is for anything someone would need to believe or dispute the verdict.** It's kept when the check doesn't pass and thrown away when it does, so you can be generous with it without filling a disk.

## Step 4: wire up the command

`src/main.ts`, and this is the whole of it:

```ts
import { registryOf, runCli, workspaceAt, type Harness } from 'harness-kernel'
import { join } from 'node:path'
import { siteTarget } from './site.js'

const harness: Harness = {
	name: 'pingbot',
	registry: registryOf({ site: siteTarget }),
	workspace: workspaceAt(join(import.meta.dirname, '..', '..')),
}

process.exitCode = await runCli(harness, process.argv.slice(2))
```

Three things, and the kernel reaches for none of them on its own: what your command is **called**, which **targets** it knows, and the **workspace** it writes into. You hand them over, which is what stops two harnesses sharing a ledger by accident.

`runCli` gives you `run`, `selfcheck`, `targets`, `coverage`, `plan`, `probe`, `quarantine`, `flakes`, `notify` and `schedule`. You didn't write any of them. If you want one of your own, pass it as the third argument rather than editing a switch.

Then a small wrapper on `bin/pingbot` so the command is a name rather than a path into `dist/`:

```bash
#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
exec node "${here}/../dist/src/main.js" "$@"
```

## Step 5: run it

```bash
npx tsc -p . && ./bin/pingbot targets
```

```text
site
  smoke            2 check(s)
```

Now point it at something. With your site up:

```bash
./bin/pingbot run --target site
```

```text

```

**That's not a mistake in this guide.** A healthy run prints nothing and exits 0. Everything the kernel does is in service of that: a tool that prints a wall of green every morning is one you've stopped reading by Thursday, and then it can't tell you anything.

## Step 6: break something

Take the about page away and run it again:

```bash
./bin/pingbot run --target site
```

```text
pingbot site/local — smoke
  run 20260907T130909Z-5df640d1   seed 5df640d1   build unknown

  FAIL  site.about
        assertion: /about answered 404, not 200
        status: 404

  3 checks — 2 pass, 1 fail
```

The exit code is 1.

Two things to notice. **The `status: 404` line is your `record` call** — the evidence you attached, kept because this one didn't pass. And **it says three checks when you wrote two**: preflight is a check like any other, and it counts.

That's a working harness. Everything below is what you already have without writing any more of it.

## What you get for free

**Eight outcomes, not two.** `pass`, `skipped`, `unsupported`, `quarantined`, `flaky`, `degraded`, `blocked`, `fail`. Only `fail` and `blocked` turn a run red. The middle four are the cases that get mislabelled when you only have two words, and each of them means something you'd otherwise lose.

**Retries for the right failures only.** A transport failure gets three attempts, a timeout gets two, and an assertion gets one — retrying a real bug just hides it. **A check that only passed on the second attempt reports `flaky`, not `pass`**, because that's the one thing the run learned about your suite and calling it green throws it away.

**One fact when the target dies.** After three failures to reach it with nothing getting through in between, the rest of the run reports `blocked` immediately. One sentence, not forty timeouts.

**A memory between runs.** Five ledgers: what wasn't green last time, how long things took, which selector candidate answered, which checks have been inconsistent, and what you've held out of the verdict on purpose. `--no-record` spares all of them at once.

**One run at a time per target**, with a lock a crashed run can't leave jamming everything after it.

**Somebody told, when there's something to say.** Mail or a webhook, carrying the console's own words. It backs off a story it's already told and won't call a recovery until it's held for two runs.

## Saying a check can't run here

This is the part most worth learning early, because it's the alternative to a check that fails for a reason that isn't your target's fault.

A check lists what it needs. If the target doesn't offer it, the kernel reports `unsupported` **before the body runs**, and names what was missing:

```ts
{
	id: 'site.admin-can-be-emptied',
	title: 'The admin can be emptied and refilled',
	suite: 'smoke',
	needs: ['isDisposable'],
	async body() { /* … */ },
}
```

Against a target that hasn't declared `isDisposable`, that reports `unsupported` and says `target does not declare: isDisposable`. It never fails, and it never quietly disappears from the sheet.

**`isDisposable` should come from the environment, never from a suite.** It means _this particular thing may be written to destructively_, and only the person who knows which one they're pointing at can answer that.

## Throwing the right kind of error

What you throw decides how it's treated, so throw deliberately.

| Throw                 | When                                 | Retried?                               |
| --------------------- | ------------------------------------ | -------------------------------------- |
| `AssertionFailure`    | A property of the target didn't hold | never — reported `fail`                |
| `PreconditionFailure` | The check couldn't be set up at all  | never — reported `blocked`             |
| `TransportFailure`    | You couldn't reach the target        | up to three attempts                   |
| anything else         | The kernel classifies it             | timeouts and known network errors only |

The distinction that matters most: **`blocked` isn't `fail`.** Your target didn't do the wrong thing — the check never got far enough to have an opinion. Calling that a failure sends someone looking for a bug that isn't there.

And where a repeat would be destructive, say so on the check itself:

```ts
import { NO_RETRY } from 'harness-kernel'
// …
retry: NO_RETRY,
```

## Where your harness keeps things

`workspaceAt(root)` gives you four directories under whatever root you hand it.

| Directory         | Commit it? | What's in it                                                                  |
| ----------------- | ---------- | ----------------------------------------------------------------------------- |
| `ledger/`         | **yes**    | What's quarantined, how selectors have drifted, which checks are inconsistent |
| `baselines/`      | **partly** | What wasn't green last time: yes. The timings: no                             |
| `results/`        | no         | One directory per run — the journal, the report, the sheet, any evidence      |
| `results/.locks/` | no         | One file per target while a run is in flight                                  |

**Commit the ledgers**, because they're facts about your software and they're the same on every machine. Putting them under review means a check going permanently unsupported shows up as a diff somebody has to approve, rather than as a quiet change on one laptop.

**Don't commit the timings.** A measurement is a fact about the machine that took it, so a laptop's history judging a CI runner's numbers reports a regression that's only a change of hardware.

## Where to go next

- [Getting started](getting-started.md) — the short version, once you've done this once
- [User guide](user-guide.md) — every command and flag your harness inherits
- [Configuration](configuration.md) — the environment it reads, and the files it keeps
- [Architecture](architecture.md) — what's inside, and how to change it
- [`drexbot`](https://github.com/kingletas/drexbot) — a real harness built on this one, forty checks against a Magento storefront
