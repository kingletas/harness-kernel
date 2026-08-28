/** The eight outcomes a check can have, ordered least to most severe; aggregation takes the maximum. */
export const VERDICTS = [
	'pass',
	'skipped',
	'unsupported',
	'quarantined',
	'flaky',
	'degraded',
	'blocked',
	'fail',
] as const

export type Verdict = (typeof VERDICTS)[number]

const SEVERITY = new Map<Verdict, number>(VERDICTS.map((verdict, index) => [verdict, index]))

export const severityOf = (verdict: Verdict): number => SEVERITY.get(verdict) ?? 0

/** The more severe of two verdicts. */
export const worse = (left: Verdict, right: Verdict): Verdict =>
	severityOf(left) >= severityOf(right) ? left : right

/** Whether a verdict must state a reason; only a pass may be silent. */
export const requiresReason = (verdict: Verdict): boolean => verdict !== 'pass'

export interface RedPolicy {
	/** Whether a measurement moving beyond its historical variance fails the run. */
	readonly degradedIsRed: boolean
}

export const DEFAULT_RED_POLICY: RedPolicy = { degradedIsRed: false }

/**
 * Whether a verdict should fail the run: `flaky` and `quarantined` are
 * statements about the suite rather than the target, and `degraded` is policy.
 */
export const isRed = (verdict: Verdict, policy: RedPolicy = DEFAULT_RED_POLICY): boolean => {
	switch (verdict) {
		case 'fail':
		case 'blocked':
			return true
		case 'degraded':
			return policy.degradedIsRed
		default:
			return false
	}
}

/** Whether a verdict is a steady state the console may stay silent about while it is unchanged. */
export const isSteadyState = (verdict: Verdict): boolean =>
	verdict === 'pass' ||
	verdict === 'skipped' ||
	verdict === 'unsupported' ||
	verdict === 'quarantined'
