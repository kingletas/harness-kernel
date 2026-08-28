import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { observe, type Observation } from '../../src/kernel/observation.js'
import { startRun } from '../../src/kernel/run.js'
import type { Verdict } from '../../src/kernel/verdict.js'
import { reportToConsole } from '../../src/reporting/console-reporter.js'
import { summarize } from '../../src/reporting/summary.js'

const run = startRun({ target: 'stub', environment: 'local', suites: ['selfcheck'], seed: 'fixed' })

const at = (id: string, verdict: Verdict): Observation =>
	observe({
		id,
		title: id,
		suite: 't',
		target: 'stub',
		runId: run.id,
		verdict,
		...(verdict === 'pass' ? {} : { reason: 'because' }),
		durationMs: 1,
		startedAt: run.startedAt,
	})

const render = (observations: Observation[], previous = '', verbose = false): string[] => {
	const lines: string[] = []
	const summary = summarize(observations, previous)
	reportToConsole(run, observations, summary, {
		colour: false,
		verbose,
		write: line => lines.push(line),
	})
	return lines
}

/** A check the circuit blocked before it ran: no attempts, and one shared reason. */
const unrun = (id: string, reason: string): Observation =>
	observe({
		id,
		title: id,
		suite: 't',
		target: 'stub',
		runId: run.id,
		verdict: 'blocked',
		reason,
		durationMs: 0,
		startedAt: run.startedAt,
	})

describe('reportToConsole', () => {
	it('folds checks that never ran into one line, whatever the width was', () => {
		// The circuit exists to stop one dead target being reported once per
		// check. Printing every check it blocked puts the wall straight back.
		const why = '3 checks could not reach the target'
		const lines = render([unrun('a', why), unrun('b', why), unrun('c', why), unrun('d', why)])

		assert.equal(lines.filter(line => line.includes('BLOCK')).length, 1)
		assert.ok(lines.some(line => line.includes('and 3 more never ran for the same reason')))
	})

	it('never folds two checks blocked for different reasons', () => {
		const lines = render([unrun('a', 'the target went away'), unrun('b', 'no fixture')])

		assert.equal(lines.filter(line => line.includes('BLOCK')).length, 2)
	})

	it('says nothing at all about a wholly passing run', () => {
		assert.deepEqual(render([at('a', 'pass'), at('b', 'pass')]), [])
	})

	it('says nothing when the known exceptions are the same as last time', () => {
		const observations = [at('a', 'pass'), at('b', 'unsupported')]
		const previous = summarize(observations).signature

		assert.deepEqual(render(observations, previous), [])
	})

	it('speaks the first time an exception appears', () => {
		const lines = render([at('a', 'pass'), at('b', 'unsupported')])
		assert.ok(lines.some(line => line.includes('b')))
	})

	it('speaks about a failure even when the previous run had the same one', () => {
		// Backing off applies to a steady state, never to something red. A failure
		// that repeats is still a failure, and silence would be a green report.
		const observations = [at('a', 'fail')]
		const previous = summarize(observations).signature
		const lines = render(observations, previous)

		assert.ok(lines.some(line => line.includes('FAIL')))
	})

	it('names the run, the seed and the build whenever it speaks', () => {
		const output = render([at('a', 'fail')]).join('\n')
		assert.match(output, /seed fixed/)
		assert.match(output, /build unknown/)
	})

	it('says what stopped failing', () => {
		const previous = summarize([at('a', 'fail')]).signature
		const output = render([at('a', 'pass')], previous).join('\n')
		assert.match(output, /fixed a/)
	})

	it('reports an unreachable target as one fact, not one per check', () => {
		const unreachable = (id: string): Observation =>
			observe({
				id,
				title: id,
				suite: 't',
				target: 'stub',
				runId: run.id,
				verdict: 'fail',
				reason: 'transport: could not reach the target',
				attempts: [{ number: 1, outcome: 'error', failureClass: 'transport', durationMs: 1 }],
				durationMs: 1,
				startedAt: run.startedAt,
			})

		const lines = render([unreachable('a'), unreachable('b'), unreachable('c')])

		assert.equal(lines.filter(line => line.includes('FAIL')).length, 1)
		assert.ok(lines.some(line => line.includes('and 2 more')))
	})

	it('never folds two assertion failures together, because they are two findings', () => {
		const lines = render([at('a', 'fail'), at('b', 'fail')])

		assert.equal(lines.filter(line => line.includes('FAIL')).length, 2)
	})

	it('shows everything when asked to be verbose', () => {
		const output = render([at('a', 'pass'), at('b', 'pass')], '', true).join('\n')
		assert.match(output, /ok\s+a/)
		assert.match(output, /2 checks/)
	})
})
