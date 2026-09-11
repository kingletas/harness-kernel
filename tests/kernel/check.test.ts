import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ArtefactStore } from '../../src/kernel/artefacts.js'
import { NO_CAPABILITIES } from '../../src/kernel/capabilities.js'
import { defaultEnvironment, runCheck, type CheckDefinition } from '../../src/kernel/check.js'
import { CircuitBreaker } from '../../src/kernel/circuit.js'
import {
	AssertionFailure,
	CheckTimeout,
	PreconditionFailure,
	TransportFailure,
} from '../../src/kernel/failure.js'
import { Quarantine } from '../../src/history/quarantine.js'
import { NO_RETRY, retryPolicy } from '../../src/kernel/retry.js'
import { startRun } from '../../src/kernel/run.js'

const run = startRun({ target: 'stub', environment: 'local', suites: ['t'], seed: 'fixed' })

const environmentWith = (overrides = {}) =>
	defaultEnvironment(run, NO_CAPABILITIES, {
		// Nothing waits in a test; the delay is the policy's business and is
		// asserted separately.
		sleep: async () => undefined,
		retry: retryPolicy({ baseDelayMs: 0 }),
		...overrides,
	})

const check = (
	body: CheckDefinition['body'],
	extra: Partial<CheckDefinition> = {},
): CheckDefinition => ({
	id: 't.one',
	title: 'One',
	suite: 't',
	body,
	...extra,
})

describe('runCheck', () => {
	it('passes a check whose body returns', async () => {
		const observation = await runCheck(
			check(async () => undefined),
			environmentWith(),
		)
		assert.equal(observation.verdict, 'pass')
		assert.equal(observation.reason, undefined)
		assert.equal(observation.attempts.length, 1)
	})

	it('never retries an assertion', async () => {
		let calls = 0
		const observation = await runCheck(
			check(async () => {
				calls += 1
				throw new AssertionFailure('the total was wrong')
			}),
			environmentWith(),
		)

		assert.equal(calls, 1)
		assert.equal(observation.verdict, 'fail')
		assert.match(observation.reason ?? '', /assertion: the total was wrong/)
	})

	it('retries transport and reports a late success as flaky', async () => {
		let calls = 0
		const observation = await runCheck(
			check(async () => {
				calls += 1
				if (calls === 1) throw new TransportFailure('connection refused')
			}),
			environmentWith(),
		)

		assert.equal(calls, 2)
		assert.equal(observation.verdict, 'flaky')
		assert.equal(observation.attempts.length, 2)
		assert.equal(observation.attempts[0]?.failureClass, 'transport')
	})

	it('fails once transport retries are exhausted', async () => {
		let calls = 0
		const observation = await runCheck(
			check(async () => {
				calls += 1
				throw new TransportFailure('connection refused')
			}),
			environmentWith(),
		)

		assert.equal(calls, 3)
		assert.equal(observation.verdict, 'fail')
	})

	it('blocks rather than fails when a precondition could not be met', async () => {
		const observation = await runCheck(
			check(async () => {
				throw new PreconditionFailure('the fixture customer could not be created')
			}),
			environmentWith(),
		)

		assert.equal(observation.verdict, 'blocked')
	})

	it('reports a missing capability without running the body', async () => {
		let ran = false
		const observation = await runCheck(
			check(
				async () => {
					ran = true
				},
				{ needs: ['browser', 'canReadDatabase'] },
			),
			environmentWith(),
		)

		assert.equal(ran, false)
		assert.equal(observation.verdict, 'unsupported')
		assert.match(observation.reason ?? '', /browser, canReadDatabase/)
	})

	it('blocks without running the body once the circuit is open', async () => {
		const circuit = new CircuitBreaker(1)
		circuit.recordFailure('transport', 'nothing answered', circuit.begin())

		let ran = false
		const observation = await runCheck(
			check(async () => {
				ran = true
			}),
			environmentWith({ circuit }),
		)

		assert.equal(ran, false)
		assert.equal(observation.verdict, 'blocked')
		assert.match(observation.reason ?? '', /could not reach the target/)
	})

	it('holds a quarantined failure out of the run verdict, and says when it expires', async () => {
		const quarantine = Quarantine.from([
			{
				id: 't.one',
				reason: 'races against the indexer',
				since: '2026-08-01T00:00:00.000Z',
				until: '2099-01-01T00:00:00.000Z',
				flakeRate: 0.4,
			},
		])

		const observation = await runCheck(
			check(async () => {
				throw new AssertionFailure('still wrong')
			}),
			environmentWith({ quarantine }),
		)

		assert.equal(observation.verdict, 'quarantined')
		assert.match(observation.reason ?? '', /until 2099-01-01/)
		assert.match(observation.reason ?? '', /still wrong/)
	})

	it('lets an expired quarantine entry go red again', async () => {
		const quarantine = Quarantine.from([
			{
				id: 't.one',
				reason: 'was flaky',
				since: '2020-01-01T00:00:00.000Z',
				until: '2020-02-01T00:00:00.000Z',
				flakeRate: 0.4,
			},
		])

		const observation = await runCheck(
			check(async () => {
				throw new AssertionFailure('still wrong')
			}),
			environmentWith({ quarantine }),
		)

		assert.equal(observation.verdict, 'fail')
	})

	it('gives the body a generator derived from the run seed', async () => {
		const seen: number[] = []
		const definition = check(async ({ rng }) => {
			seen.push(rng())
		})

		await runCheck(definition, environmentWith())
		const first = seen[0]
		await runCheck(definition, environmentWith())

		assert.equal(seen[1], first)
	})
})

describe('evidence a check left behind', () => {
	const withStore = () => {
		const root = mkdtempSync(join(tmpdir(), 'run-'))
		return { root, environment: environmentWith({ artefacts: new ArtefactStore(root) }) }
	}

	/** Writes a file into the check's own directory and declares it, as a browser would. */
	const leavesATrace: CheckDefinition['body'] = async ({ artefactDir, attach }) => {
		const dir = artefactDir()
		assert.ok(dir, 'a run keeping evidence must offer a directory')
		const path = join(dir, 'trace.zip')
		writeFileSync(path, Buffer.alloc(64))
		attach('trace', path)
	}

	it('carries it on the observation when the check failed', async () => {
		const { environment } = withStore()
		const observation = await runCheck(
			check(async context => {
				await leavesATrace(context)
				throw new AssertionFailure('the total was wrong')
			}),
			environment,
		)

		assert.equal(observation.verdict, 'fail')
		assert.deepEqual(
			observation.artefacts.map(artefact => artefact.kind),
			['trace'],
		)
	})

	it('takes the whole directory back when the check passed', async () => {
		// The store's own unit tests passed while nothing called discard: a check
		// that needs no explaining was still leaving a directory per run.
		const { root, environment } = withStore()
		const observation = await runCheck(check(leavesATrace), environment)

		assert.equal(observation.verdict, 'pass')
		assert.deepEqual(observation.artefacts, [])
		assert.equal(existsSync(join(root, 'artefacts', 't.one')), false)
	})

	it('offers no directory to a run that keeps no evidence', async () => {
		let offered: string | undefined = 'something'
		await runCheck(
			check(async ({ artefactDir }) => {
				offered = artefactDir()
			}),
			environmentWith(),
		)

		assert.equal(offered, undefined)
	})
})

describe('a check that runs past its time limit', () => {
	const hangs = (): Promise<void> => new Promise(() => undefined)

	/** Waits in a call that only the abort ends, the way a browser step does once its page is closed. */
	const stuckUntilAborted =
		(message: string): CheckDefinition['body'] =>
		({ signal }) =>
			new Promise((_, reject) => {
				signal.addEventListener('abort', () => reject(new Error(message)), { once: true })
			})

	it('ends a body that never settles in a timeout verdict, within its limit', async () => {
		const started = Date.now()
		const observation = await runCheck(
			check(hangs),
			environmentWith({ timeLimitMs: 100, settleMs: 50, retry: NO_RETRY }),
		)

		assert.equal(observation.verdict, 'fail')
		assert.equal(observation.attempts[0]?.failureClass, 'timeout')
		assert.match(observation.reason ?? '', /^timeout: ran past its 0\.1s time limit/)
		assert.match(observation.reason ?? '', /did not stop within 0\.05s of being asked/)
		assert.ok(Date.now() - started < 2_000, 'the verdict arrived long after the limit')
	})

	it('aborts the body and names the step it was stopped in', async () => {
		let reason: unknown
		const observation = await runCheck(
			check(async context => {
				context.signal.addEventListener('abort', () => {
					reason = context.signal.reason as unknown
				})
				await stuckUntilAborted('locator.click: Target page, context or browser has been closed')(
					context,
				)
			}),
			environmentWith({ timeLimitMs: 100, retry: NO_RETRY }),
		)

		assert.ok(reason instanceof CheckTimeout)
		assert.equal(
			observation.reason,
			'timeout: ran past its 0.1s time limit, and was stopped in: ' +
				'locator.click: Target page, context or browser has been closed',
		)
	})

	it('retries it once, the way the policy retries any timeout', async () => {
		let calls = 0
		const observation = await runCheck(
			check(async context => {
				calls += 1
				await stuckUntilAborted('stuck')(context)
			}),
			environmentWith({ timeLimitMs: 50 }),
		)

		assert.equal(calls, 2)
		assert.equal(observation.verdict, 'fail')
		assert.deepEqual(
			observation.attempts.map(attempt => attempt.failureClass),
			['timeout', 'timeout'],
		)
	})

	it("holds a check to its own limit rather than the run's", async () => {
		const observation = await runCheck(
			check(stuckUntilAborted('stuck'), { timeLimitMs: 50 }),
			environmentWith({ timeLimitMs: 60_000, retry: NO_RETRY }),
		)

		assert.match(observation.reason ?? '', /ran past its 0\.05s time limit/)
	})

	it('carries evidence the body attached while it was stopping', async () => {
		const root = mkdtempSync(join(tmpdir(), 'run-'))
		const observation = await runCheck(
			check(async ({ signal, artefactDir, attach }) => {
				await new Promise<void>((_, reject) => {
					signal.addEventListener('abort', () => {
						const path = join(artefactDir() ?? root, 'trace.zip')
						writeFileSync(path, Buffer.alloc(64))
						attach('trace', path)
						reject(new Error('closed'))
					})
				})
			}),
			environmentWith({ timeLimitMs: 50, retry: NO_RETRY, artefacts: new ArtefactStore(root) }),
		)

		assert.deepEqual(
			observation.artefacts.map(artefact => artefact.kind),
			['trace'],
		)
	})

	it('leaves a check that finishes inside its limit alone', async () => {
		let aborted = true
		const observation = await runCheck(
			check(async ({ signal }) => {
				await new Promise(resolve => setTimeout(resolve, 20))
				aborted = signal.aborted
			}),
			environmentWith({ timeLimitMs: 1_000 }),
		)

		assert.equal(observation.verdict, 'pass')
		assert.equal(aborted, false)
		assert.equal(observation.attempts.length, 1)
	})

	it('reports a body that throws inside its limit as it always did', async () => {
		const observation = await runCheck(
			check(async () => {
				throw new AssertionFailure('the total was wrong')
			}),
			environmentWith({ timeLimitMs: 1_000 }),
		)

		assert.equal(observation.reason, 'assertion: the total was wrong')
	})

	it('refuses a limit of zero, which a browser library would read as no limit at all', async () => {
		await assert.rejects(
			runCheck(check(hangs, { timeLimitMs: 0 }), environmentWith()),
			/the time limit for t\.one must be a positive number/,
		)
	})
})
