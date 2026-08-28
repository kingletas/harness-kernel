import { stateSignature, type Observation } from '../kernel/observation.js'
import { isRed, VERDICTS, worse, type RedPolicy, type Verdict } from '../kernel/verdict.js'

export interface Summary {
	readonly counts: Readonly<Record<Verdict, number>>
	readonly total: number
	readonly worst: Verdict
	readonly red: boolean
	readonly signature: string
	/** True when this run's non-passing set differs from the previous run's. */
	readonly changed: boolean
	/** Non-passing observations the previous run did not have in this state. */
	readonly newly: readonly Observation[]
	/** Ids that were non-passing last run and are not now. */
	readonly resolved: readonly string[]
}

const emptyCounts = (): Record<Verdict, number> =>
	Object.fromEntries(VERDICTS.map(verdict => [verdict, 0])) as Record<Verdict, number>

/**
 * Reduces a run to what a reporter needs; `changed` is the field the silence
 * contract turns on, so an unchanged story has nothing to say.
 */
export const summarize = (
	observations: readonly Observation[],
	previousSignature = '',
	policy?: RedPolicy,
): Summary => {
	const counts = emptyCounts()
	let worst: Verdict = 'pass'
	let red = false

	for (const observation of observations) {
		counts[observation.verdict] += 1
		worst = worse(worst, observation.verdict)
		if (isRed(observation.verdict, policy)) red = true
	}

	const signature = stateSignature(observations)
	const previous = new Set(previousSignature.split('\n').filter(line => line !== ''))
	const current = new Set(signature.split('\n').filter(line => line !== ''))

	return {
		counts,
		total: observations.length,
		worst,
		red,
		signature,
		changed: signature !== previousSignature,
		newly: observations.filter(
			observation =>
				observation.verdict !== 'pass' && !previous.has(`${observation.id}:${observation.verdict}`),
		),
		resolved: [...previous]
			.filter(line => !current.has(line))
			.map(line => line.slice(0, line.lastIndexOf(':'))),
	}
}
