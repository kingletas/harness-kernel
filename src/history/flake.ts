import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Observation } from '../kernel/observation.js'
import type { Verdict } from '../kernel/verdict.js'

/** What one check did, over its recent runs. Oldest first. */
export interface OutcomeSeries {
	readonly outcomes: readonly Verdict[]
}

export interface FlakeFile {
	readonly version: 1
	readonly checks: Readonly<Record<string, OutcomeSeries>>
}

export interface FlakePolicy {
	/** Runs of history before a rate means anything. */
	readonly minRuns: number
	/** Failure rate at or above which a check is worth a decision. */
	readonly minRate: number
	/** How many runs of history to keep. */
	readonly window: number
}

export const DEFAULT_FLAKE_POLICY: FlakePolicy = { minRuns: 6, minRate: 0.2, window: 25 }

export interface Candidate {
	readonly id: string
	readonly runs: number
	readonly failures: number
	readonly rate: number
	/** Whether a retry has ever rescued it, which is the strongest evidence. */
	readonly rescuedByRetry: boolean
}

export const emptyFlakes = (): FlakeFile => ({ version: 1, checks: {} })

export const loadFlakes = (path: string): FlakeFile => {
	if (!existsSync(path)) return emptyFlakes()
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as FlakeFile
	} catch {
		return emptyFlakes()
	}
}

export const saveFlakes = (path: string, flakes: FlakeFile): void => {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(flakes, null, '\t')}\n`, 'utf8')
}

/**
 * Records what each check did, including on a red run: a failure is the
 * observation being counted, so a ledger of good runs could conclude only one thing.
 */
export const recordOutcomes = (
	observations: readonly Observation[],
	flakes: FlakeFile,
	policy: FlakePolicy = DEFAULT_FLAKE_POLICY,
): FlakeFile => {
	const checks: Record<string, OutcomeSeries> = { ...flakes.checks }

	for (const observation of observations) {
		// An absence is not evidence about stability, so it is not recorded at
		// all: a check that could not run tells us nothing about whether it would
		// have been consistent.
		if (observation.verdict === 'unsupported' || observation.verdict === 'skipped') continue

		checks[observation.id] = {
			outcomes: [...(checks[observation.id]?.outcomes ?? []), observation.verdict].slice(
				-policy.window,
			),
		}
	}

	return { version: 1, checks }
}

/**
 * Checks whose recent history is inconsistent enough to need a decision; one
 * that fails every time is never a candidate, because that is a real defect.
 */
export const candidates = (
	flakes: FlakeFile,
	policy: FlakePolicy = DEFAULT_FLAKE_POLICY,
): readonly Candidate[] => {
	const found: Candidate[] = []

	for (const [id, series] of Object.entries(flakes.checks)) {
		const runs = series.outcomes.length
		if (runs < policy.minRuns) continue

		const failures = series.outcomes.filter(verdict => verdict !== 'pass').length
		if (failures === 0 || failures === runs) continue

		const rate = failures / runs
		if (rate < policy.minRate) continue

		found.push({
			id,
			runs,
			failures,
			rate: Number(rate.toFixed(2)),
			rescuedByRetry: series.outcomes.includes('flaky'),
		})
	}

	return found.sort((left, right) => right.rate - left.rate)
}

/**
 * Drops one check's history, for what an arranged run taught. Reports whether
 * anything was there, so a mistyped id cannot read as a success.
 */
export const forgetCheck = (
	flakes: FlakeFile,
	id: string,
): { readonly flakes: FlakeFile; readonly forgotten: boolean } => {
	if (flakes.checks[id] === undefined) return { flakes, forgotten: false }

	const checks = { ...flakes.checks }
	delete checks[id]
	return { flakes: { version: 1, checks }, forgotten: true }
}
