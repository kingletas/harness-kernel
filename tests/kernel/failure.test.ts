import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	AssertionFailure,
	classify,
	isRetryable,
	PreconditionFailure,
	TransportFailure,
} from '../../src/kernel/failure.js'

describe('classify', () => {
	it('recognises the harness own failure types', () => {
		assert.equal(classify(new AssertionFailure('total was wrong')), 'assertion')
		assert.equal(classify(new PreconditionFailure('no fixture')), 'precondition')
		assert.equal(classify(new TransportFailure('refused')), 'transport')
	})

	it('reads a connection error from its code', () => {
		assert.equal(
			classify(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })),
			'transport',
		)
		assert.equal(classify(Object.assign(new Error('dns'), { code: 'ENOTFOUND' })), 'transport')
		assert.equal(classify(Object.assign(new Error('slow'), { code: 'ETIMEDOUT' })), 'timeout')
	})

	it('reads a connection error from its message when there is no code', () => {
		assert.equal(classify(new Error('socket hang up')), 'transport')
		assert.equal(classify(new Error('fetch failed')), 'transport')
		assert.equal(classify(new Error('net::ERR_CONNECTION_REFUSED at http://x')), 'transport')
	})

	it('calls a structured assertion an assertion even when it mentions a timeout', () => {
		// An assertion that ran out of time is still an assertion. Reading the
		// message first would make it retryable, and a retried assertion can turn a
		// real defect green.
		const expectFailure = Object.assign(new Error('Timed out 5000ms waiting for expect(locator)'), {
			matcherResult: { pass: false },
		})
		assert.equal(classify(expectFailure), 'assertion')
		assert.equal(isRetryable(classify(expectFailure)), false)
	})

	it('treats an unexplained error as an assertion, so it is not retried', () => {
		assert.equal(classify(new Error('something went wrong')), 'assertion')
		assert.equal(classify('a string'), 'assertion')
	})

	it('retries only transport and timeout', () => {
		assert.equal(isRetryable('transport'), true)
		assert.equal(isRetryable('timeout'), true)
		assert.equal(isRetryable('assertion'), false)
		assert.equal(isRetryable('precondition'), false)
	})
})
