import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NO_RETRY, retryPolicy } from '../../src/kernel/retry.js'
import { deriveRng } from '../../src/kernel/seed.js'

describe('retryPolicy', () => {
	it('allows one attempt for anything that must not be retried', () => {
		const policy = retryPolicy()
		assert.equal(policy.attemptsFor('assertion'), 1)
		assert.equal(policy.attemptsFor('precondition'), 1)
	})

	it('gives transport more attempts than timeout', () => {
		const policy = retryPolicy()
		assert.ok(policy.attemptsFor('transport') > policy.attemptsFor('timeout'))
	})

	it('backs off further on each attempt', () => {
		const policy = retryPolicy({ baseDelayMs: 100 })
		const rng = deriveRng('seed', 'backoff')
		const first = policy.delayMs('transport', 1, rng)
		const second = policy.delayMs('transport', 2, rng)
		const third = policy.delayMs('transport', 3, rng)

		assert.ok(first <= second && second <= third, `${first} ${second} ${third}`)
	})

	it('waits the same on a replay of the same seed', () => {
		const policy = retryPolicy({ baseDelayMs: 100 })
		const once = policy.delayMs('transport', 2, deriveRng('seed', 'backoff'))
		const again = policy.delayMs('transport', 2, deriveRng('seed', 'backoff'))
		assert.equal(once, again)
	})

	it('never waits for something it will not retry', () => {
		const policy = retryPolicy({ baseDelayMs: 100 })
		assert.equal(policy.delayMs('assertion', 1, deriveRng('seed', 'x')), 0)
	})

	it('offers a policy that never retries at all', () => {
		assert.equal(NO_RETRY.attemptsFor('transport'), 1)
	})
})
