import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { observe, type Measurement, type Observation } from '../kernel/observation.js'
import { distributionOf } from '../reporting/percentile.js'

/** One measurement's recent history, oldest first. */
export interface Series {
	readonly samples: readonly number[]
	readonly unit: string
}

export interface BaselineFile {
	readonly version: 1
	readonly series: Readonly<Record<string, Series>>
}

export interface BaselinePolicy {
	/** Samples needed before a comparison is allowed to reach a verdict. */
	readonly minSamples: number
	/** How many standard deviations past the mean counts as a move. */
	readonly sigmas: number
	/** How many times the mean the value must also reach, since sigma alone calls 4ms against 3ms a regression. */
	readonly minRatio: number
	/** The smallest move worth a verdict, per unit, beneath which proportion means nothing. */
	readonly minDelta: Readonly<Record<Measurement['unit'], number>>
	/** How many runs of history to keep. */
	readonly window: number
}

export const DEFAULT_BASELINE_POLICY: BaselinePolicy = {
	minSamples: 5,
	sigmas: 4,
	minRatio: 1.5,
	minDelta: { ms: 50, bytes: 50_000, count: 1, ratio: 0.05 },
	window: 20,
}

const keyOf = (observation: Observation, measurement: Measurement): string =>
	`${observation.id}|${measurement.name}|${measurement.stage ?? '-'}`

export const emptyBaseline = (): BaselineFile => ({ version: 1, series: {} })

export const loadBaseline = (path: string): BaselineFile => {
	if (!existsSync(path)) return emptyBaseline()
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as BaselineFile
	} catch {
		// A corrupt baseline must not stop a run: the worst it can cost is the
		// history, and a run that refuses to start because of it is worse.
		return emptyBaseline()
	}
}

export const saveBaseline = (path: string, baseline: BaselineFile): void => {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(baseline, null, '\t')}\n`, 'utf8')
}

/**
 * Judges this run's measurements against their own history, downgrading only a
 * passing observation and only when sigma, ratio and the noise floor all agree.
 * @see README, "Performance is judged against history, not against a budget".
 */
export const judgeMeasurements = (
	observations: readonly Observation[],
	baseline: BaselineFile,
	policy: BaselinePolicy = DEFAULT_BASELINE_POLICY,
): readonly Observation[] =>
	observations.map(observation => {
		if (observation.verdict !== 'pass' || observation.measurements.length === 0) return observation

		const moved: string[] = []

		for (const measurement of observation.measurements) {
			const series = baseline.series[keyOf(observation, measurement)]
			if (series === undefined || series.samples.length < policy.minSamples) continue

			const history = distributionOf(series.samples)
			const threshold = history.mean + policy.sigmas * history.stdDev

			const delta = measurement.value - history.mean

			if (
				measurement.value > threshold &&
				measurement.value > history.mean * policy.minRatio &&
				delta >= policy.minDelta[measurement.unit]
			) {
				moved.push(
					`${measurement.name}${measurement.stage ? ` at ${measurement.stage}` : ''} ` +
						`was ${measurement.value}${measurement.unit}, against ${Math.round(history.mean)}` +
						`±${Math.round(history.stdDev)}${measurement.unit} over ${history.count} runs`,
				)
			}
		}

		if (moved.length === 0) return observation

		return observe({
			...observation,
			verdict: 'degraded',
			reason: moved.join('; '),
		})
	})

/**
 * Folds this run's measurements into the history, and only a passing
 * observation contributes: a degraded number folded in is how a complaint disappears.
 */
export const recordMeasurements = (
	observations: readonly Observation[],
	baseline: BaselineFile,
	policy: BaselinePolicy = DEFAULT_BASELINE_POLICY,
): BaselineFile => {
	const series: Record<string, Series> = { ...baseline.series }

	for (const observation of observations) {
		if (observation.verdict !== 'pass') continue

		for (const measurement of observation.measurements) {
			const key = keyOf(observation, measurement)
			const existing = series[key]?.samples ?? []
			series[key] = {
				unit: measurement.unit,
				samples: [...existing, measurement.value].slice(-policy.window),
			}
		}
	}

	return { version: 1, series }
}
