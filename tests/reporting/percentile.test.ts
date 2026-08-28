import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { distributionOf, percentile } from '../../src/reporting/percentile.js'

describe('percentile', () => {
	it('reports a value the system actually produced', () => {
		const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
		for (const rank of [50, 90, 95, 99]) {
			assert.ok(samples.includes(percentile(samples, rank)), `p${rank} was interpolated`)
		}
	})

	it('does not depend on the order of the samples', () => {
		assert.equal(percentile([5, 1, 4, 2, 3], 50), percentile([1, 2, 3, 4, 5], 50))
	})

	it('handles a single sample and an empty one', () => {
		assert.equal(percentile([7], 99), 7)
		assert.ok(Number.isNaN(percentile([], 50)))
	})

	it('summarises a distribution', () => {
		const distribution = distributionOf([2, 4, 4, 4, 5, 5, 7, 9])
		assert.equal(distribution.count, 8)
		assert.equal(distribution.mean, 5)
		assert.equal(distribution.stdDev, 2)
		assert.equal(distribution.min, 2)
		assert.equal(distribution.max, 9)
	})
})
