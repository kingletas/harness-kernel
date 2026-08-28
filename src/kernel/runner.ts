import type { CheckDefinition, CheckEnvironment } from './check.js'
import { runCheck } from './check.js'
import type { Journal } from './journal.js'
import { observe, type Observation } from './observation.js'
import { refusesDestructiveWork, type PreflightResult } from './preflight.js'

export interface RunnerOptions {
	/** Records each observation as it happens, so a killed run keeps its work. */
	readonly journal?: Journal
	/** Check ids already observed by a previous attempt at this run. */
	readonly resumeFrom?: ReadonlySet<string>
	/** The suite provisions or destroys, so the target must declare itself disposable. */
	readonly writes?: boolean
	/** How many checks may be in flight at once. Declared, never derived; one by default. */
	readonly concurrency?: number
}

/** The one blocked observation a writing suite gets when it may not write here. */
const refusalObservation = (environment: CheckEnvironment): Observation =>
	observe({
		id: 'kernel.disposable-target',
		title: 'The target accepts destructive work',
		suite: 'kernel',
		target: environment.run.target,
		runId: environment.run.id,
		verdict: 'blocked',
		reason:
			`"${environment.run.environment}" does not declare itself disposable, ` +
			'and this suite provisions or destroys data',
		durationMs: 0,
		startedAt: environment.now().toISOString(),
	})

/**
 * Runs a list of checks up to `concurrency` at a time and returns one
 * observation for each, in definition order rather than in the order they
 * finished. @see README, "Checks run one at a time until you say otherwise".
 */
export const runChecks = async (
	definitions: readonly CheckDefinition[],
	environment: CheckEnvironment,
	options: RunnerOptions = {},
): Promise<readonly Observation[]> => {
	const { journal, resumeFrom, writes = false, concurrency = 1 } = options

	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new Error(`a worker pool needs a width of at least 1, not ${concurrency}`)
	}

	if (writes && refusesDestructiveWork(environment.capabilities)) {
		return [refusalObservation(environment)]
	}

	const pending = definitions.filter(definition => !resumeFrom?.has(definition.id))
	const results = new Array<Observation | undefined>(pending.length)
	const held = new Set<string>()
	const started = new Set<number>()
	const inFlight = new Set<Promise<void>>()

	/** The earliest check nothing in flight is contending with, if there is one. */
	const nextRunnable = (): number | undefined => {
		for (const [index, definition] of pending.entries()) {
			if (started.has(index)) continue
			const resource = definition.contends
			if (resource !== undefined && held.has(resource)) continue
			return index
		}
		return undefined
	}

	const start = (index: number): void => {
		const definition = pending[index] as CheckDefinition
		const resource = definition.contends
		started.add(index)
		if (resource !== undefined) held.add(resource)

		const task: Promise<void> = (async () => {
			const observation = await runCheck(definition, environment)
			results[index] = observation
			journal?.append({ kind: 'observation', observation })
		})().finally(() => {
			if (resource !== undefined) held.delete(resource)
			inFlight.delete(task)
		})

		inFlight.add(task)
	}

	while (started.size < pending.length || inFlight.size > 0) {
		while (inFlight.size < concurrency) {
			const index = nextRunnable()
			if (index === undefined) break
			start(index)
		}

		// Nothing runnable and nothing running would mean a check contending with
		// itself, which cannot happen: a resource is only ever held in flight.
		if (inFlight.size === 0) break
		await Promise.race(inFlight)
	}

	return results.filter((observation): observation is Observation => observation !== undefined)
}

/** Turns a failed preflight into the single blocked observation a run reports. */
export const preflightObservation = (
	result: PreflightResult,
	target: string,
	runId: string,
	startedAt: string,
): Observation =>
	observe({
		id: 'kernel.preflight',
		title: 'The target is reachable and identifies itself',
		suite: 'kernel',
		target,
		runId,
		verdict: result.reachable ? 'pass' : 'blocked',
		...(result.reachable ? {} : { reason: result.problem ?? 'the target did not answer' }),
		evidence: [{ label: 'build', detail: result.build }],
		durationMs: 0,
		startedAt,
	})
