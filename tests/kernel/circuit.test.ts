import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CircuitBreaker } from '../../src/kernel/circuit.js'

/** A failure from a check that began just now — the sequential case. */
const failNow = (
	circuit: CircuitBreaker,
	failure: 'transport' | 'assertion' | 'timeout' | 'precondition',
	detail = 'refused',
) => circuit.recordFailure(failure, detail, circuit.begin())

describe('CircuitBreaker', () => {
	it('opens once enough checks fail to reach the target with none reaching it between', () => {
		const circuit = new CircuitBreaker(3)
		failNow(circuit, 'transport')
		failNow(circuit, 'transport')
		assert.equal(circuit.isOpen, false)

		failNow(circuit, 'transport')
		assert.equal(circuit.isOpen, true)
		assert.match(circuit.reason ?? '', /3 checks could not reach the target/)
	})

	it('does not count an assertion failure, because the target is plainly up', () => {
		const circuit = new CircuitBreaker(2)
		failNow(circuit, 'transport')
		failNow(circuit, 'assertion', 'the total was wrong')
		failNow(circuit, 'transport')

		assert.equal(circuit.isOpen, false)
	})

	it('resets on a check that reached the target', () => {
		const circuit = new CircuitBreaker(2)
		failNow(circuit, 'transport')
		circuit.recordReachable()
		failNow(circuit, 'transport')

		assert.equal(circuit.isOpen, false)
	})

	it('ignores a precondition, which says nothing about whether the target is up', () => {
		// A fixture the harness could not build is not evidence of a live target,
		// so it must not hold a dead one's run open by resetting the count.
		const circuit = new CircuitBreaker(2)
		failNow(circuit, 'transport')
		failNow(circuit, 'precondition', 'no store baseline')
		failNow(circuit, 'transport')

		assert.equal(circuit.isOpen, true)
	})

	it('keeps the reason it first opened with', () => {
		const circuit = new CircuitBreaker(1)
		failNow(circuit, 'transport', 'the first thing')
		failNow(circuit, 'transport', 'a later thing')

		assert.match(circuit.reason ?? '', /the first thing/)
	})

	it('refuses a threshold below one', () => {
		assert.throws(() => new CircuitBreaker(0), /at least 1/)
	})
})

describe('CircuitBreaker under interleaving', () => {
	it('discards a failure from a check that was overtaken by a success', () => {
		// A and B start together, B reaches the target, then A fails. The target
		// answered while A was trying, so A's failure is about A.
		const circuit = new CircuitBreaker(2)
		const a = circuit.begin()
		const b = circuit.begin()
		void b
		circuit.recordReachable()
		circuit.recordFailure('transport', 'refused', a)

		const c = circuit.begin()
		circuit.recordFailure('transport', 'refused', c)
		assert.equal(circuit.isOpen, false)
	})

	it('opens on failures that all began before anything reached the target', () => {
		// Three checks in flight against a dead target. Nothing contacts it, so
		// every token is still current when its failure lands.
		const circuit = new CircuitBreaker(3)
		const tokens = [circuit.begin(), circuit.begin(), circuit.begin()]
		for (const token of tokens) circuit.recordFailure('transport', 'refused', token)

		assert.equal(circuit.isOpen, true)
	})

	it('does not care what order the failures land in', () => {
		const forward = new CircuitBreaker(3)
		const forwardTokens = [forward.begin(), forward.begin(), forward.begin()]
		for (const token of forwardTokens) forward.recordFailure('transport', 'refused', token)

		const reverse = new CircuitBreaker(3)
		const reverseTokens = [reverse.begin(), reverse.begin(), reverse.begin()]
		for (const token of [...reverseTokens].reverse()) {
			reverse.recordFailure('transport', 'refused', token)
		}

		assert.equal(forward.isOpen, reverse.isOpen)
		assert.equal(reverse.isOpen, true)
	})
})
