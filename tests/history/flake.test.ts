import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	candidates,
	emptyFlakes,
	forgetCheck,
	recordOutcomes,
	type FlakeFile,
} from '../../src/history/flake.js'
import { observe, type Observation } from '../../src/kernel/observation.js'
import type { Verdict } from '../../src/kernel/verdict.js'

const at = (id: string, verdict: Verdict): Observation =>
	observe({
		id,
		title: id,
		suite: 't',
		target: 'stub',
		runId: 'run-1',
		verdict,
		...(verdict === 'pass' ? {} : { reason: 'because' }),
		durationMs: 1,
		startedAt: '2026-08-27T00:00:00.000Z',
	})

const history = (id: string, outcomes: Verdict[]): FlakeFile => ({
	version: 1,
	checks: { [id]: { outcomes } },
})

const P: Verdict = 'pass'
const F: Verdict = 'fail'

describe('recordOutcomes', () => {
	it('records a failure as readily as a pass', () => {
		// The whole point is to see the bad runs. A ledger that only kept the good
		// ones could conclude only that everything is fine.
		const recorded = recordOutcomes([at('a', 'fail')], emptyFlakes())

		assert.deepEqual(recorded.checks['a']?.outcomes, ['fail'])
	})

	it('ignores a check that could not run', () => {
		// An absence says nothing about whether a check is stable.
		const recorded = recordOutcomes([at('a', 'unsupported'), at('b', 'skipped')], emptyFlakes())

		assert.deepEqual(Object.keys(recorded.checks), [])
	})

	it('keeps the window bounded', () => {
		const long = Array.from({ length: 25 }, (): Verdict => 'pass')
		const recorded = recordOutcomes([at('a', 'fail')], history('a', long))

		assert.equal(recorded.checks['a']?.outcomes.length, 25)
		assert.equal(recorded.checks['a']?.outcomes.at(-1), 'fail')
	})
})

describe('candidates', () => {
	it('waits for enough history before saying anything', () => {
		assert.deepEqual(candidates(history('a', [P, F, P])), [])
	})

	it('names a check that both passes and fails', () => {
		const found = candidates(history('a', [P, F, P, F, P, F, P, P]))

		assert.equal(found[0]?.id, 'a')
		assert.equal(found[0]?.failures, 3)
		assert.equal(found[0]?.rate, 0.38)
	})

	it('never names a check that fails every time', () => {
		// The important exclusion. Quarantining something consistently broken
		// silences a real defect, which is the opposite of what quarantine is for.
		assert.deepEqual(candidates(history('a', [F, F, F, F, F, F, F, F])), [])
	})

	it('never names a check that always passes', () => {
		assert.deepEqual(candidates(history('a', [P, P, P, P, P, P, P, P])), [])
	})

	it('ignores a wobble too small to be worth a decision', () => {
		assert.deepEqual(candidates(history('a', [P, P, P, P, P, P, P, P, P, F])), [])
	})

	it('says when a retry has rescued it, which is the strongest evidence', () => {
		const found = candidates(history('a', [P, 'flaky', P, 'flaky', P, F, P, P]))

		assert.equal(found[0]?.rescuedByRetry, true)
	})

	it('puts the worst first', () => {
		const flakes: FlakeFile = {
			version: 1,
			checks: {
				mild: { outcomes: [P, P, P, P, P, F, P, F] },
				bad: { outcomes: [F, F, P, F, F, P, F, P] },
			},
		}

		assert.deepEqual(
			candidates(flakes).map(candidate => candidate.id),
			['bad', 'mild'],
		)
	})
})

describe('forgetCheck', () => {
	it('drops the history of the check it names, and nothing else', () => {
		const flakes: FlakeFile = {
			version: 1,
			checks: { arranged: { outcomes: [P, F] }, real: { outcomes: [P, P] } },
		}
		const result = forgetCheck(flakes, 'arranged')

		assert.equal(result.forgotten, true)
		assert.deepEqual(Object.keys(result.flakes.checks), ['real'])
	})

	it('says when there was nothing there', () => {
		// A mistyped id that reports success leaves the misleading history in place
		// and the person believing it is gone.
		const result = forgetCheck(history('a', [P, F]), 'b')

		assert.equal(result.forgotten, false)
		assert.deepEqual(Object.keys(result.flakes.checks), ['a'])
	})

	it('leaves the loaded ledger alone', () => {
		const flakes = history('a', [P, F])
		forgetCheck(flakes, 'a')

		assert.deepEqual(Object.keys(flakes.checks), ['a'])
	})
})
