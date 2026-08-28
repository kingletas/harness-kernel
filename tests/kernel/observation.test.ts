import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { observe, stateSignature } from '../../src/kernel/observation.js'

const base = {
	id: 'x.one',
	title: 'One',
	suite: 'x',
	target: 'stub',
	runId: 'run-1',
	durationMs: 1,
	startedAt: '2026-08-27T00:00:00.000Z',
}

describe('observe', () => {
	it('accepts a pass with no reason', () => {
		assert.equal(observe({ ...base, verdict: 'pass' }).verdict, 'pass')
	})

	it('refuses any other verdict with no reason', () => {
		// A red line nobody can act on is indistinguishable from a harness bug, so
		// it is refused where it is built rather than rendered and puzzled over.
		for (const verdict of ['fail', 'blocked', 'degraded', 'unsupported', 'skipped'] as const) {
			assert.throws(() => observe({ ...base, verdict }), /states no reason/)
		}
		assert.throws(() => observe({ ...base, verdict: 'fail', reason: '   ' }), /states no reason/)
	})

	it('defaults the collections rather than leaving them undefined', () => {
		const observation = observe({ ...base, verdict: 'pass' })
		assert.deepEqual(observation.evidence, [])
		assert.deepEqual(observation.measurements, [])
		assert.deepEqual(observation.attempts, [])
	})
})

describe('stateSignature', () => {
	it('ignores passes and does not depend on order', () => {
		const one = observe({ ...base, id: 'a', verdict: 'fail', reason: 'r' })
		const two = observe({ ...base, id: 'b', verdict: 'unsupported', reason: 'r' })
		const three = observe({ ...base, id: 'c', verdict: 'pass' })

		assert.equal(stateSignature([one, two, three]), stateSignature([three, two, one]))
		assert.equal(stateSignature([one, two, three]), 'a:fail\nb:unsupported')
	})

	it('is empty for a wholly passing run', () => {
		assert.equal(stateSignature([observe({ ...base, verdict: 'pass' })]), '')
	})
})
