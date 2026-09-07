# Getting started

Ten minutes, if you've built a harness on this before. If you haven't, [From nothing to your own harness](from-nothing.md) covers the same ground and explains the ideas on the way past.

## Contents

- [Try it without building anything](#try-it-without-building-anything)
- [Add it to a project](#add-it-to-a-project)
- [The three things you supply](#the-three-things-you-supply)
- [A check, minimally](#a-check-minimally)
- [Prove your harness both ways](#prove-your-harness-both-ways)

## Try it without building anything

The package ships a stub target and proves itself against it.

```bash
npx harness-selfcheck selfcheck
```

Six checks, no network, nothing of yours involved. On a fresh install it prints a summary; run it again and it says nothing, because the outcome hasn't changed. That silence is the contract, not a bug.

## Add it to a project

```bash
npm install github:kingletas/harness-kernel
```

No runtime dependencies, and it builds itself on install. Node 20.19 or newer, ES modules only.

> [!NOTE]
> **npm 12 refuses git dependencies by default**, stopping with `EALLOWGIT`. Use `npm install --allow-git=all`, or npm 11, which Node 24 still ships.

## The three things you supply

```ts
import { registryOf, runCli, workspaceAt, type Harness } from 'harness-kernel'

const harness: Harness = {
	name: 'pingbot',
	registry: registryOf({ site: siteTarget }),
	workspace: workspaceAt(join(import.meta.dirname, '..', '..')),
}

process.exitCode = await runCli(harness, process.argv.slice(2))
```

A name, your targets, and somewhere to write. The kernel is handed all three and reaches for none of them, which is what stops two harnesses sharing a ledger by accident.

`runCli` brings `run`, `selfcheck`, `targets`, `coverage`, `plan`, `probe`, `quarantine`, `flakes`, `notify` and `schedule`. Add one of your own with the third argument rather than by editing a switch.

## A check, minimally

```ts
{
	id: 'site.home',              // stable across renames — the ledgers hold on to it
	title: 'The home page answers',
	suite: 'smoke',
	area: 'pages',                // a row on your sign-off sheet
	needs: ['isDisposable'],      // optional: reports `unsupported` rather than failing
	retry: NO_RETRY,              // optional: where a repeat would be destructive
	async body({ record }) {
		record('status', '200')     // kept only when this doesn't pass
		throw new AssertionFailure('…')
	},
}
```

What you throw decides how it's treated. `AssertionFailure` is a fail and is never retried. `PreconditionFailure` is `blocked` — the check never got far enough to have an opinion. `TransportFailure` gets up to three attempts.

## Prove your harness both ways

A green run and a red one are different code paths, and passing one says nothing about the other.

```bash
./bin/yourharness run --target yours
```

Silence and exit 0 when it's healthy. Break something on purpose and you should get the check, the verdict, your recorded evidence and exit 1. **If you've only ever seen one of those, you've tested half of it.**

Everything else — every flag, every verdict, the ledgers and the notification rules — is in the [user guide](user-guide.md).
