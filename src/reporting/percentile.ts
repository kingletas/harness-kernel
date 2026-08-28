/**
 * Nearest-rank percentile over a copy of the samples, so every value it reports
 * is one the system actually produced.
 */
export const percentile = (samples: readonly number[], rank: number): number => {
	if (samples.length === 0) return Number.NaN

	const sorted = [...samples].sort((left, right) => left - right)
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1),
	)
	return sorted[index] as number
}

export interface Distribution {
	readonly count: number
	readonly min: number
	readonly p50: number
	readonly p95: number
	readonly p99: number
	readonly max: number
	readonly mean: number
	/** Population standard deviation, which is what the baseline comparison uses. */
	readonly stdDev: number
}

export const distributionOf = (samples: readonly number[]): Distribution => {
	if (samples.length === 0) {
		return { count: 0, min: NaN, p50: NaN, p95: NaN, p99: NaN, max: NaN, mean: NaN, stdDev: NaN }
	}

	const mean = samples.reduce((total, value) => total + value, 0) / samples.length
	const variance = samples.reduce((total, value) => total + (value - mean) ** 2, 0) / samples.length

	return {
		count: samples.length,
		min: Math.min(...samples),
		p50: percentile(samples, 50),
		p95: percentile(samples, 95),
		p99: percentile(samples, 99),
		max: Math.max(...samples),
		mean,
		stdDev: Math.sqrt(variance),
	}
}
