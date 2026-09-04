import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { digest, readReports } from '../../history/schedule.js'
import {
	enableCommands,
	environmentFile,
	ScheduleRefused,
	serviceUnit,
	timerUnit,
	unitBase,
	type ScheduleSpec,
} from '../../schedule/systemd.js'
import type { Harness } from '../harness.js'

const USAGE = (name: string): string =>
	`usage: ${name} schedule plan|install --target <name> [--every <calendar>] [--suite a,b]
       ${name} schedule report [--days 7] [--target <name>]

  plan     Print the units and what install would do, writing nothing
  install  Write the units under ~/.config/systemd/user and print what enables them
  report   What every schedule has actually been doing, for a weekly read
`

const valueAfter = (argv: readonly string[], flag: string): string | undefined => {
	const index = argv.indexOf(flag)
	return index === -1 ? undefined : argv[index + 1]
}

const hours = (ms: number): string =>
	ms >= 86_400_000
		? `${(ms / 86_400_000).toFixed(1)}d`
		: ms >= 3_600_000
			? `${(ms / 3_600_000).toFixed(1)}h`
			: `${Math.round(ms / 60_000)}m`

const specFor = (harness: Harness, argv: readonly string[]): ScheduleSpec | undefined => {
	const target = valueAfter(argv, '--target')
	if (target === undefined) return undefined
	const suites = valueAfter(argv, '--suite')

	return {
		name: harness.name,
		target,
		...(suites === undefined ? {} : { suites: suites.split(',').map(one => one.trim()) }),
		onCalendar: valueAfter(argv, '--every') ?? 'daily',
		command: join(harness.workspace.root, 'bin', harness.name),
		workingDirectory: harness.workspace.root,
	}
}

/** What a person runs after the units are written; nothing here enables anything. */
const printFinishing = (spec: ScheduleSpec): void => {
	process.stdout.write('\nThen, to make it a schedule:\n\n')
	for (const command of enableCommands(spec)) process.stdout.write(`  ${command}\n`)
	// %h is systemd's, and means nothing at a prompt: the unit keeps it, the
	// person is told the path they can actually open.
	const where = environmentFile(spec).replace('%h', homedir())
	process.stdout.write(
		`\nThe channel's variables go in ${where} — HARNESS_NOTIFY and\n` +
			'the rest, mode 0600. They are deliberately not in the unit: a webhook URL\n' +
			'carries its token, and a unit file is readable by anyone on the machine.\n',
	)
}

const plan = (harness: Harness, argv: readonly string[]): number => {
	const spec = specFor(harness, argv)
	if (spec === undefined) {
		process.stderr.write(USAGE(harness.name))
		return 2
	}

	process.stdout.write(`# ${unitBase(spec)}.service\n${serviceUnit(spec)}\n`)
	process.stdout.write(`# ${unitBase(spec)}.timer\n${timerUnit(spec)}`)
	process.stdout.write(
		`\nWould write both under ${join(homedir(), '.config/systemd/user')} and enable nothing.\n`,
	)
	printFinishing(spec)
	return 0
}

const install = (harness: Harness, argv: readonly string[]): number => {
	const spec = specFor(harness, argv)
	if (spec === undefined) {
		process.stderr.write(USAGE(harness.name))
		return 2
	}

	if (process.platform !== 'linux') {
		process.stderr.write(
			`${harness.name}: systemd units are Linux-only, and this is ${process.platform}\n` +
				"  Nothing was written. Use the platform's own scheduler with the command in `schedule plan`.\n",
		)
		return 2
	}

	const directory = join(homedir(), '.config', 'systemd', 'user')
	mkdirSync(directory, { recursive: true })
	const service = join(directory, `${unitBase(spec)}.service`)
	const timer = join(directory, `${unitBase(spec)}.timer`)
	writeFileSync(service, serviceUnit(spec), 'utf8')
	writeFileSync(timer, timerUnit(spec), 'utf8')

	process.stdout.write(`  wrote ${service}\n  wrote ${timer}\n`)
	process.stdout.write('\nNeither is enabled: writing a unit changes nothing until you say so.\n')
	printFinishing(spec)
	return 0
}

/** A lock file left behind, and how long it has been there. */
const heldLocks = (harness: Harness): readonly { name: string; since: string }[] => {
	const directory = harness.workspace.locks
	if (!existsSync(directory)) return []

	return readdirSync(directory)
		.filter(file => file.endsWith('.lock'))
		.map(file => {
			const parsed = JSON.parse(readFileSync(join(directory, file), 'utf8')) as {
				since?: string
			}
			return { name: file.replace(/\.lock$/, ''), since: parsed.since ?? '' }
		})
}

const report = (harness: Harness, argv: readonly string[]): number => {
	const days = Number(valueAfter(argv, '--days') ?? '7')
	if (!Number.isFinite(days) || days <= 0) {
		process.stderr.write(`${harness.name}: --days needs a positive number\n`)
		return 2
	}

	const only = valueAfter(argv, '--target')
	const since = new Date(Date.now() - days * 86_400_000)
	const windows = digest(readReports(harness.workspace.results, since)).filter(
		window => only === undefined || window.target === only,
	)

	process.stdout.write(`\n  ${harness.name} — the last ${days} day(s)\n\n`)
	if (windows.length === 0) {
		process.stdout.write('  no runs at all in this window\n\n')
		return 0
	}

	for (const window of windows) {
		const ago = Date.now() - new Date(window.lastAt).getTime()
		process.stdout.write(`  ${window.target}/${window.environment}\n`)
		process.stdout.write(
			`    ${window.runs} run(s), ${window.red} red · last ${hours(ago)} ago · ` +
				`longest gap ${hours(window.longestGapMs)}\n`,
		)
		for (const failing of window.failing.slice(0, 5)) {
			process.stdout.write(`    ${failing.runs} of ${window.runs}   ${failing.id}\n`)
		}
		process.stdout.write('\n')
	}

	for (const lock of heldLocks(harness)) {
		const age = lock.since === '' ? 0 : Date.now() - new Date(lock.since).getTime()
		process.stdout.write(`  a run is holding ${lock.name}, ${hours(age)} old\n`)
	}

	return 0
}

export const scheduleCommand = (harness: Harness, argv: readonly string[]): number => {
	try {
		switch (argv[0]) {
			case 'plan':
				return plan(harness, argv)
			case 'install':
				return install(harness, argv)
			case 'report':
				return report(harness, argv)
			default:
				process.stderr.write(USAGE(harness.name))
				return 2
		}
	} catch (cause) {
		if (!(cause instanceof ScheduleRefused)) throw cause
		process.stderr.write(`${harness.name}: ${cause.message}\n`)
		return 2
	}
}
