import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { observe, type Observation } from '../../src/kernel/observation.js'
import type { Verdict } from '../../src/kernel/verdict.js'
import { summarize } from '../../src/reporting/summary.js'

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

describe('summarize', () => {
	it('counts, and takes the worst verdict', () => {
		const summary = summarize([at('a', 'pass'), at('b', 'flaky'), at('c', 'fail')])

		assert.equal(summary.total, 3)
		assert.equal(summary.counts.fail, 1)
		assert.equal(summary.worst, 'fail')
		assert.equal(summary.red, true)
	})

	it('is not red for a run whose only exceptions are known ones', () => {
		const summary = summarize([at('a', 'pass'), at('b', 'unsupported'), at('c', 'quarantined')])
		assert.equal(summary.red, false)
	})

	it('says nothing changed when the same exceptions are present again', () => {
		// The silence contract turns on this: a run telling last run's story has
		// nothing to say, however many non-passing checks it holds.
		const observations = [at('a', 'pass'), at('b', 'unsupported')]
		const first = summarize(observations)
		const second = summarize(observations, first.signature)

		assert.equal(second.changed, false)
		assert.deepEqual(second.newly, [])
	})

	it('reports only what is new against the previous run', () => {
		const before = summarize([at('a', 'unsupported'), at('b', 'pass')])
		const after = summarize([at('a', 'unsupported'), at('b', 'fail')], before.signature)

		assert.equal(after.changed, true)
		assert.deepEqual(
			after.newly.map(observation => observation.id),
			['b'],
		)
	})

	it('names what stopped being a problem', () => {
		const before = summarize([at('a', 'fail'), at('b', 'fail')])
		const after = summarize([at('a', 'fail'), at('b', 'pass')], before.signature)

		assert.deepEqual(after.resolved, ['b'])
	})

	it('treats a check changing verdict as news, not as unchanged', () => {
		const before = summarize([at('a', 'flaky')])
		const after = summarize([at('a', 'fail')], before.signature)

		assert.equal(after.changed, true)
		assert.deepEqual(
			after.newly.map(observation => observation.id),
			['a'],
		)
	})
})
