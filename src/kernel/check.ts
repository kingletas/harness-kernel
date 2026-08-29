import type { Artefact, ArtefactStore } from './artefacts.js'
import { missingCapabilities, type Capabilities, type CapabilityName } from './capabilities.js'
import { CircuitBreaker, type CircuitToken } from './circuit.js'
import { classify, describe, UnsupportedCapability } from './failure.js'
import {
	observe,
	type Attempt,
	type Evidence,
	type Measurement,
	type Observation,
} from './observation.js'
import { Quarantine } from '../history/quarantine.js'
import { DEFAULT_RETRY_POLICY, type RetryPolicy } from './retry.js'
import type { RunIdentity } from './run.js'
import { deriveRng, type Rng } from './seed.js'
import type { Verdict } from './verdict.js'

/** What a check body is handed. */
export interface CheckContext {
	readonly run: RunIdentity
	/** Derived from the run seed and this check's id, so it is order-independent. */
	readonly rng: Rng
	/** Something a person would need to believe or dispute the verdict. */
	readonly record: (label: string, detail: string) => void
	/** A number to carry alongside the verdict, for baselines and reports. */
	readonly measure: (measurement: Measurement) => void
	/**
	 * A directory this check may leave evidence in, created on first use, or
	 * undefined when the run is not keeping any.
	 */
	readonly artefactDir: () => string | undefined
	/** Declares a file written into that directory, to be attached to the observation. */
	readonly attach: (kind: string, absolutePath: string) => void
}

export interface CheckDefinition {
	/** Stable across runs and across renames of the title. */
	readonly id: string
	readonly title: string
	readonly suite: string
	/** The sign-off sheet row this check reports into. */
	readonly area?: string
	/** Capabilities without which this check cannot mean anything. */
	readonly needs?: readonly CapabilityName[]
	/** Overrides the run's policy — used where a repeat would be destructive. */
	readonly retry?: RetryPolicy
	/** A resource this check will not share; the pool runs no two of these at once. */
	readonly contends?: string
	body(context: CheckContext): Promise<void>
}

export interface CheckEnvironment {
	readonly run: RunIdentity
	readonly capabilities: Capabilities
	readonly circuit: CircuitBreaker
	readonly quarantine: Quarantine
	readonly retry: RetryPolicy
	readonly now: () => Date
	readonly sleep: (ms: number) => Promise<void>
	/** Where evidence goes and what the run may spend on it. Absent means keep none. */
	readonly artefacts?: ArtefactStore
}

export const defaultEnvironment = (
	run: RunIdentity,
	capabilities: Capabilities,
	overrides: Partial<CheckEnvironment> = {},
): CheckEnvironment => ({
	run,
	capabilities,
	circuit: new CircuitBreaker(),
	quarantine: Quarantine.empty(),
	retry: DEFAULT_RETRY_POLICY,
	now: () => new Date(),
	sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
	...overrides,
})

/**
 * Runs one check and turns whatever happens into exactly one observation,
 * asking capability first, then the circuit, and only then the body.
 */
export const runCheck = async (
	definition: CheckDefinition,
	environment: CheckEnvironment,
): Promise<Observation> => {
	const { run, capabilities, circuit, quarantine, now } = environment
	const startedAt = now()
	const evidence: Evidence[] = []
	const measurements: Measurement[] = []

	const base = {
		id: definition.id,
		title: definition.title,
		suite: definition.suite,
		...(definition.area === undefined ? {} : { area: definition.area }),
		target: run.target,
		runId: run.id,
		startedAt: startedAt.toISOString(),
	}

	const missing = missingCapabilities(definition.needs ?? [], capabilities)
	if (missing.length > 0) {
		return observe({
			...base,
			verdict: 'unsupported',
			reason: new UnsupportedCapability(missing).message,
			durationMs: 0,
		})
	}

	if (circuit.isOpen) {
		return observe({
			...base,
			verdict: 'blocked',
			reason: circuit.reason ?? 'the target was unreachable',
			durationMs: 0,
		})
	}

	const store = environment.artefacts
	const context: CheckContext = {
		run,
		rng: deriveRng(run.seed, definition.id),
		record: (label, detail) => evidence.push({ label, detail }),
		measure: measurement => measurements.push(measurement),
		artefactDir: () => (store?.accepting === true ? store.dirFor(definition.id) : undefined),
		attach: (kind, absolutePath) => store?.claim(definition.id, kind, absolutePath),
	}

	/**
	 * Evidence is kept only where the verdict needs explaining. A passing check
	 * that left a trace behind is a disk filling up for nothing.
	 */
	const collect = (verdict: Verdict): { artefacts: readonly Artefact[]; dropped?: string } =>
		store === undefined || verdict === 'pass' ? { artefacts: [] } : store.collect(definition.id)

	const policy = definition.retry ?? environment.retry
	const attempts: Attempt[] = []
	const backoffRng = deriveRng(run.seed, `${definition.id}:backoff`)
	let attemptNumber = 0
	let allowed = 1
	let token: CircuitToken = circuit.begin()

	for (;;) {
		attemptNumber += 1
		const attemptStarted = now().getTime()
		// Taken per attempt rather than per check, so the failure that is finally
		// recorded is judged against the moment its own attempt began.
		token = circuit.begin()

		try {
			await definition.body(context)
			attempts.push({
				number: attemptNumber,
				outcome: 'ok',
				durationMs: now().getTime() - attemptStarted,
			})
			circuit.recordReachable()

			// A check that only passed on a later attempt is evidence about the suite,
			// and reporting it as a pass throws that evidence away.
			const held = attemptNumber > 1 ? quarantine.entryFor(definition.id, startedAt) : undefined
			const verdict = attemptNumber === 1 ? 'pass' : held !== undefined ? 'quarantined' : 'flaky'

			// A standing decision is reported as one. Somebody quarantined this
			// check and wrote down why; showing `flaky` every run afterwards reads
			// as though nobody had.
			const reason =
				held !== undefined
					? `quarantined until ${held.until} — ${held.reason}; passed on attempt ${attemptNumber} of ${allowed}`
					: `passed on attempt ${attemptNumber} of ${allowed}`

			const kept = collect(verdict)
			if (kept.dropped !== undefined) evidence.push({ label: 'evidence', detail: kept.dropped })

			return observe({
				...base,
				verdict,
				...(verdict === 'pass' ? {} : { reason }),
				evidence,
				measurements,
				attempts,
				artefacts: kept.artefacts,
				durationMs: now().getTime() - startedAt.getTime(),
			})
		} catch (error) {
			const failure = classify(error)
			allowed = policy.attemptsFor(failure)
			attempts.push({
				number: attemptNumber,
				outcome: 'error',
				failure: describe(error),
				failureClass: failure,
				durationMs: now().getTime() - attemptStarted,
			})

			if (attemptNumber < allowed) {
				await environment.sleep(policy.delayMs(failure, attemptNumber, backoffRng))
				continue
			}

			circuit.recordFailure(failure, describe(error), token)

			const held = quarantine.entryFor(definition.id, startedAt)
			const verdict =
				held !== undefined ? 'quarantined' : failure === 'precondition' ? 'blocked' : 'fail'
			const reason =
				held !== undefined
					? `quarantined until ${held.until} — ${held.reason}; this run: ${describe(error)}`
					: `${failure}: ${describe(error)}`

			const kept = collect(verdict)
			if (kept.dropped !== undefined) evidence.push({ label: 'evidence', detail: kept.dropped })

			return observe({
				...base,
				verdict,
				reason,
				evidence,
				measurements,
				attempts,
				artefacts: kept.artefacts,
				durationMs: now().getTime() - startedAt.getTime(),
			})
		}
	}
}
