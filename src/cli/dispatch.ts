import { parse, usageFor, type ExtraCommand } from './options.js'
import { checkCoverage } from './commands/coverage.js'
import { listFlakes, forgetFlakes } from './commands/flakes.js'
import { planOnly } from './commands/plan.js'
import { probeTarget } from './commands/probe.js'
import { quarantineCommand } from './commands/quarantine.js'
import { runAgainstTarget } from './commands/run.js'
import { selfcheck } from './commands/selfcheck.js'
import { testChannel } from './commands/notify.js'
import { listTargets } from './commands/targets.js'
import type { Harness } from './harness.js'

/**
 * Every command each harness shares, dispatched for whichever tool is asking.
 * A tool adds its own with `extras` rather than by editing this switch.
 */
export const runCli = async (
	harness: Harness,
	argv: readonly string[],
	extras: Readonly<Record<string, ExtraCommand>> = {},
): Promise<number> => {
	const [command = 'help', ...rest] = argv
	const USAGE = usageFor(harness, extras)

	// Refused rather than aliased: widening it silently would leave anyone who
	// learned the old behaviour with no way to notice the difference.
	if (rest.includes('--no-signature')) {
		process.stderr.write(
			`${harness.name}: --no-signature is gone — use --no-record\n` +
				'  It spared the signature and the measurement baseline and went on recording the\n' +
				'  drift and flake ledgers, so a run made to test something else still taught them.\n',
		)
		return 2
	}

	const width = parse(rest).workers
	if (!Number.isInteger(width) || width < 1) {
		process.stderr.write(
			`${harness.name}: --workers needs a whole number of at least 1, not "${width}"\n`,
		)
		return 2
	}

	const extra = extras[command]
	if (extra !== undefined) return extra.run(harness, parse(rest), rest)

	switch (command) {
		case 'run':
			return runAgainstTarget(harness, parse(rest))
		case 'selfcheck':
			return selfcheck(harness, parse(rest))
		case 'targets':
			return listTargets(harness)
		case 'coverage':
			return checkCoverage(harness, parse(rest).target)
		case 'plan':
			return planOnly(harness, parse(rest))
		case 'probe':
			return probeTarget(harness, parse(rest))
		case 'quarantine':
			return quarantineCommand(harness, rest)
		case 'notify': {
			if (!rest.includes('--test')) {
				process.stderr.write(`usage: ${harness.name} notify --test\n`)
				return 2
			}
			return testChannel(harness)
		}
		case 'flakes': {
			const forget = rest.indexOf('--forget')
			const id = forget === -1 ? undefined : rest[forget + 1]
			if (forget !== -1 && id === undefined) {
				process.stderr.write(
					`usage: ${harness.name} flakes --forget <check-id> [--target <name>]\n`,
				)
				return 2
			}
			return id === undefined
				? listFlakes(harness, parse(rest).target)
				: forgetFlakes(harness, id, parse(rest).target)
		}
		case 'help':
		case '--help':
		case '-h':
			process.stdout.write(USAGE)
			return 0
		default:
			process.stderr.write(`${harness.name}: unknown command "${command}"\n\n${USAGE}`)
			return 2
	}
}
