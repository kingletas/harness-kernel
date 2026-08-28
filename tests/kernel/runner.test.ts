import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NO_CAPABILITIES } from '../../src/kernel/capabilities.js'
import { defaultEnvironment, type CheckDefinition } from '../../src/kernel/check.js'
import { CircuitBreaker } from '../../src/kernel/circuit.js'
import { TransportFailure } from '../../src/kernel/failure.js'
import { retryPolicy } from '../../src/kernel/retry.js'
import { startRun } from '../../src/kernel/run.js'
import { runChecks } from '../../src/kernel/runner.js'

const environment = (circuit = new CircuitBreaker()) =>
	defaultEnvironment(
		startRun({ target: 'stub', environment: 'local', suites: ['x'], seed: 'fixed' }),
		NO_CAPABILITIES,
		{
			circuit,
			retry: retryPolicy({ baseDelayMs: 0 }),
			sleep: async () => undefined,
		},
	)

const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** A check that takes `ms` and records when it started and finished. */
const timed = (
	id: string,
	ms: number,
	log: string[],
	extra: Partial<CheckDefinition> = {},
): CheckDefinition => ({
	id,
	title: id,
	suite: 'x',
	...extra,
	async body() {
		log.push(`start ${id}`)
		await pause(ms)
		log.push(`end ${id}`)
	},
})

describe('the worker pool', () => {
	it('runs one at a time by default', async () => {
		const log: string[] = []
		const checks = [timed('a', 20, log), timed('b', 1, log), timed('c', 1, log)]

		await runChecks(checks, environment())

		assert.deepEqual(log, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
	})

	it('overlaps checks once it is given a width', async () => {
		const log: string[] = []
		const checks = [timed('a', 30, log), timed('b', 1, log), timed('c', 1, log)]

		await runChecks(checks, environment(), { concurrency: 3 })

		// b and c both start before a is done, which is the whole claim.
		assert.deepEqual(log.slice(0, 3), ['start a', 'start b', 'start c'])
	})

	it('returns observations in definition order however they finished', async () => {
		const log: string[] = []
		const checks = [timed('slow', 30, log), timed('quick', 1, log)]

		const observations = await runChecks(checks, environment(), { concurrency: 2 })

		assert.deepEqual(log.at(-1), 'end slow')
		assert.deepEqual(
			observations.map(observation => observation.id),
			['slow', 'quick'],
		)
	})

	it('never has two checks contending for the same resource in flight', async () => {
		const log: string[] = []
		const checks = [
			timed('one', 20, log, { contends: 'fixtures' }),
			timed('two', 1, log, { contends: 'fixtures' }),
			timed('free', 1, log),
		]

		await runChecks(checks, environment(), { concurrency: 3 })

		assert.ok(log.indexOf('end one') < log.indexOf('start two'))
		// The uncontended one is not held back by them.
		assert.ok(log.indexOf('start free') < log.indexOf('end one'))
	})

	it('refuses a width that is not a whole number of at least one', async () => {
		await assert.rejects(
			() => runChecks([], environment(), { concurrency: 0 }),
			/width of at least 1/,
		)
		await assert.rejects(
			() => runChecks([], environment(), { concurrency: 2.5 }),
			/width of at least 1/,
		)
	})

	it('skips what a previous attempt at this run already observed', async () => {
		const log: string[] = []
		const checks = [timed('a', 1, log), timed('b', 1, log)]

		const observations = await runChecks(checks, environment(), {
			resumeFrom: new Set(['a']),
			concurrency: 2,
		})

		assert.deepEqual(
			observations.map(observation => observation.id),
			['b'],
		)
	})
})

describe('a run is reproducible whatever its width', () => {
	/** Each check draws from its own stream, so the values must not move. */
	const drawing = (id: string): CheckDefinition => ({
		id,
		title: id,
		suite: 'x',
		async body({ rng, record }) {
			await pause(id === 'a' ? 15 : 1)
			record('drew', `${rng()}`)
		},
	})

	it('gives every check the same values at width 1 and at width 8', async () => {
		const checks = [drawing('a'), drawing('b'), drawing('c'), drawing('d')]

		const sequential = await runChecks(checks, environment(), { concurrency: 1 })
		const wide = await runChecks(checks, environment(), { concurrency: 8 })

		const shape = (
			observations: readonly { id: string; evidence: readonly { detail: string }[] }[],
		) => observations.map(observation => `${observation.id}=${observation.evidence[0]?.detail}`)

		assert.deepEqual(shape(wide), shape(sequential))
	})
})

describe('a dead target under a wide run', () => {
	const dead = (id: string): CheckDefinition => ({
		id,
		title: id,
		suite: 'x',
		async body() {
			await pause(1)
			throw new TransportFailure('connection refused')
		},
	})

	it('collapses to one open circuit rather than one per worker', async () => {
		const checks = Array.from({ length: 12 }, (_, index) => dead(`dead-${index}`))
		const circuit = new CircuitBreaker(3)

		const observations = await runChecks(checks, environment(circuit), { concurrency: 4 })

		assert.equal(circuit.isOpen, true)
		const blocked = observations.filter(observation => observation.verdict === 'blocked')
		const failed = observations.filter(observation => observation.verdict === 'fail')

		// The workers in flight when it opened still report their own failure; every
		// check after that is blocked without touching the target.
		assert.ok(failed.length >= 3, `expected at least the threshold to fail, got ${failed.length}`)
		assert.ok(blocked.length > 0)
		assert.equal(new Set(blocked.map(observation => observation.reason)).size, 1)
	})
})
