import type { Observation } from '../kernel/observation.js'
import type { RunIdentity } from '../kernel/run.js'
import { isRed, type Verdict } from '../kernel/verdict.js'
import type { Summary } from './summary.js'

const MARK: Readonly<Record<Verdict, string>> = {
	pass: 'ok',
	skipped: 'skip',
	unsupported: 'n/a',
	quarantined: 'held',
	flaky: 'flake',
	degraded: 'slow',
	blocked: 'BLOCK',
	fail: 'FAIL',
}

const COLOUR: Readonly<Record<Verdict, string>> = {
	pass: '32',
	skipped: '90',
	unsupported: '90',
	quarantined: '36',
	flaky: '35',
	degraded: '33',
	blocked: '31',
	fail: '31',
}

const ESC = String.fromCharCode(27)

/** The directory an artefact sits in, for a line that points somewhere. */
const dirOf = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1)

const lastFailureClass = (observation: Observation): string | undefined =>
	observation.attempts.at(-1)?.failureClass

/**
 * Groups observations that are all one fact, so a target that stopped answering
 * costs one line rather than one per check.
 */
const collapse = (observations: readonly Observation[]): Observation[][] => {
	const groups: Observation[][] = []
	const open = new Map<string, Observation[]>()

	for (const observation of observations) {
		// Only a cause outside the check folds: unreachability across differing
		// reasons, a precondition or an unrun check on an identical one.
		// An assertion never folds — each is a finding in its own right.
		const failure = lastFailureClass(observation)
		const key =
			failure === 'transport'
				? 'transport'
				: failure === 'precondition'
					? `precondition:${observation.reason ?? ''}`
					: observation.attempts.length === 0 && observation.verdict === 'blocked'
						? `unrun:${observation.reason ?? ''}`
						: observation.id

		const held = open.get(key)
		if (held === undefined) {
			const group = [observation]
			open.set(key, group)
			groups.push(group)
		} else {
			held.push(observation)
		}
	}

	return groups
}

export interface ConsoleOptions {
	/** Off when stdout is not a terminal, so a captured log stays readable. */
	readonly colour?: boolean
	/** Report every observation rather than only what changed. */
	readonly verbose?: boolean
	readonly write?: (line: string) => void
}

/**
 * Renders a run, writing nothing at all when it is green and its known
 * exceptions are unchanged. @see README, "Silence is the contract".
 */
export const reportToConsole = (
	run: RunIdentity,
	observations: readonly Observation[],
	summary: Summary,
	options: ConsoleOptions = {},
): void => {
	const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`))
	const colour = options.colour ?? process.stdout.isTTY === true
	const paint = (verdict: Verdict, text: string): string =>
		colour ? `${ESC}[${COLOUR[verdict]}m${text}${ESC}[0m` : text

	if (!summary.red && !summary.changed && !options.verbose) return

	write('')
	write(`houndbot ${run.target}/${run.environment} — ${run.suites.join(', ')}`)
	write(`  run ${run.id}   seed ${run.seed}   build ${run.build}`)
	write('')

	// Backing off applies to a steady state and never to something red: a failure
	// that repeats is still a failure, and naming it only the first time would
	// leave every later run reporting a headline with nothing under it.
	const shown = options.verbose
		? observations
		: observations.filter(
				observation =>
					isRed(observation.verdict) ||
					summary.newly.some(candidate => candidate.id === observation.id),
			)

	for (const group of options.verbose ? shown.map(one => [one]) : collapse(shown)) {
		const first = group[0] as Observation
		const mark = paint(first.verdict, MARK[first.verdict].padEnd(5))
		write(`  ${mark} ${first.id}`)
		if (first.reason !== undefined) write(`        ${first.reason}`)
		for (const evidence of first.evidence) {
			write(`        ${evidence.label}: ${evidence.detail}`)
		}
		// Named on the line that failed, not left for somebody to find: on a remote
		// runner the files are all anyone will ever get.
		const [firstArtefact] = first.artefacts
		if (firstArtefact !== undefined) {
			const total = first.artefacts.reduce((sum, artefact) => sum + artefact.bytes, 0)
			const kinds = first.artefacts.map(artefact => artefact.kind).join(', ')
			write(
				`        evidence: ${kinds} (${Math.round(total / 1024)}KB) in ${dirOf(firstArtefact.path)}`,
			)
		}
		if (group.length > 1) {
			const why =
				lastFailureClass(first) === 'transport'
					? 'the target did not answer'
					: first.attempts.length === 0
						? 'never ran for the same reason'
						: 'blocked on the same thing'
			write(`        and ${group.length - 1} more ${why}`)
		}
	}

	if (summary.resolved.length > 0) {
		write('')
		for (const id of summary.resolved) write(`  ${paint('pass', 'fixed')} ${id}`)
	}

	write('')
	const tally = (Object.entries(summary.counts) as [Verdict, number][])
		.filter(([, count]) => count > 0)
		.map(([verdict, count]) => `${count} ${verdict}`)
		.join(', ')
	write(`  ${summary.total} checks — ${tally}`)
	write('')
}
