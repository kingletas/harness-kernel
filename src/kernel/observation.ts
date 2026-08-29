import type { Artefact } from './artefacts.js'
import { requiresReason, type Verdict } from './verdict.js'

/** A number a check measured, carried alongside its verdict. */
export interface Measurement {
	readonly name: string
	readonly value: number
	readonly unit: 'ms' | 'bytes' | 'count' | 'ratio'
	/** The journey stage or route this number belongs to. */
	readonly stage?: string
}

/** Something a person would need in order to believe or dispute the verdict. */
export interface Evidence {
	readonly label: string
	readonly detail: string
}

/** One attempt at a check, kept even when a later attempt succeeded. */
export interface Attempt {
	readonly number: number
	readonly outcome: 'ok' | 'error'
	readonly failure?: string
	readonly failureClass?: string
	readonly durationMs: number
}

/** The single result type every reporter consumes. */
export interface Observation {
	/** Stable across runs and across renames of the title. */
	readonly id: string
	readonly title: string
	readonly suite: string
	/** The sign-off sheet row this check reports into. */
	readonly area?: string
	readonly target: string
	readonly runId: string
	readonly verdict: Verdict
	/** Required for every verdict except `pass`. */
	readonly reason?: string
	readonly evidence: readonly Evidence[]
	readonly measurements: readonly Measurement[]
	readonly attempts: readonly Attempt[]
	/** Files this check left behind, so a failure can be read rather than guessed at. */
	readonly artefacts: readonly Artefact[]
	readonly durationMs: number
	readonly startedAt: string
}

export interface ObservationInput extends Omit<
	Observation,
	'evidence' | 'measurements' | 'attempts' | 'artefacts'
> {
	readonly evidence?: readonly Evidence[]
	readonly measurements?: readonly Measurement[]
	readonly attempts?: readonly Attempt[]
	readonly artefacts?: readonly Artefact[]
}

/**
 * Builds an observation, refusing a non-passing verdict with no reason — a red
 * line nobody can act on is indistinguishable from a harness bug.
 */
export const observe = (input: ObservationInput): Observation => {
	if (requiresReason(input.verdict) && !input.reason?.trim()) {
		throw new Error(`observation "${input.id}" is ${input.verdict} and states no reason`)
	}

	return {
		...input,
		evidence: input.evidence ?? [],
		measurements: input.measurements ?? [],
		attempts: input.attempts ?? [],
		artefacts: input.artefacts ?? [],
	}
}

/**
 * The set of non-passing outcomes in a run as a comparable string, sorted so
 * check order does not change it; an equal one means the same story.
 */
export const stateSignature = (observations: readonly Observation[]): string =>
	observations
		.filter(observation => observation.verdict !== 'pass')
		.map(observation => `${observation.id}:${observation.verdict}`)
		.sort()
		.join('\n')
