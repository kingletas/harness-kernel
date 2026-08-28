import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isRed, isSteadyState, requiresReason, worse } from '../../src/kernel/verdict.js'

describe('verdict', () => {
	it('takes the more severe of two', () => {
		assert.equal(worse('pass', 'fail'), 'fail')
		assert.equal(worse('flaky', 'degraded'), 'degraded')
		assert.equal(worse('skipped', 'pass'), 'skipped')
	})

	it('lets only a pass go without a reason', () => {
		assert.equal(requiresReason('pass'), false)
		for (const verdict of ['fail', 'blocked', 'flaky', 'quarantined', 'skipped'] as const) {
			assert.equal(requiresReason(verdict), true)
		}
	})

	it('fails the run on a failure or a blocked target, and on nothing else by default', () => {
		assert.equal(isRed('fail'), true)
		assert.equal(isRed('blocked'), true)
		assert.equal(isRed('flaky'), false)
		assert.equal(isRed('quarantined'), false)
		assert.equal(isRed('unsupported'), false)
	})

	it('makes a degraded measurement red only when policy says so', () => {
		assert.equal(isRed('degraded'), false)
		assert.equal(isRed('degraded', { degradedIsRed: true }), true)
	})

	it('counts a known exception as a steady state and a failure as news', () => {
		assert.equal(isSteadyState('unsupported'), true)
		assert.equal(isSteadyState('quarantined'), true)
		assert.equal(isSteadyState('fail'), false)
		assert.equal(isSteadyState('flaky'), false)
	})
})
