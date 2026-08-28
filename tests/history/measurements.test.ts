import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { observe, type Measurement, type Observation } from '../../src/kernel/observation.js'
import type { Verdict } from '../../src/kernel/verdict.js'
import {
	emptyBaseline,
	judgeMeasurements,
	loadBaseline,
	recordMeasurements,
	type BaselineFile,
} from '../../src/history/measurements.js'

const observation = (verdict: Verdict, measurements: Measurement[]): Observation =>
	observe({
		id: 'x.latency',
		title: 'Latency',
		suite: 't',
		target: 'stub',
		runId: 'run-1',
		verdict,
		...(verdict === 'pass' ? {} : { reason: 'because' }),
		measurements,
		durationMs: 1,
		startedAt: '2026-08-27T00:00:00.000Z',
	})

const ms = (value: number): Measurement => ({
	name: 'response',
	value,
	unit: 'ms',
	stage: '/health',
})

const withHistory = (samples: number[]): BaselineFile => ({
	version: 1,
	series: { 'x.latency|response|/health': { samples, unit: 'ms' } },
})

const verdictAfter = (baseline: BaselineFile, value: number): Verdict =>
	judgeMeasurements([observation('pass', [ms(value)])], baseline)[0]?.verdict ?? 'pass'

describe('judgeMeasurements', () => {
	it('says nothing about a measurement with no history', () => {
		assert.equal(verdictAfter(emptyBaseline(), 5000), 'pass')
	})

	it('waits for enough history before reaching a verdict', () => {
		// Two runs is not a distribution. Judging against it would make the third
		// run of anything a coin toss.
		assert.equal(verdictAfter(withHistory([10, 11]), 5000), 'pass')
	})

	it('leaves a normal value alone', () => {
		assert.equal(verdictAfter(withHistory([100, 105, 98, 102, 101, 99]), 104), 'pass')
	})

	it('calls a gross regression degraded, and quotes the numbers', () => {
		const baseline = withHistory([100, 105, 98, 102, 101, 99])
		const judged = judgeMeasurements([observation('pass', [ms(900)])], baseline)[0]

		assert.equal(judged?.verdict, 'degraded')
		assert.match(judged?.reason ?? '', /response at \/health was 900ms/)
		assert.match(judged?.reason ?? '', /over 6 runs/)
	})

	it('does not call 5ms against 3ms a regression', () => {
		// Sigma and ratio are both proportional and both clear here: 5ms is past
		// four deviations of a 3ms mean and well over half again. It is still
		// noise, and the absolute floor is the only guard that knows that.
		assert.equal(verdictAfter(withHistory([3, 3, 3, 3, 3, 4]), 5), 'pass')
	})

	it('still catches a real move on a fast measurement', () => {
		assert.equal(verdictAfter(withHistory([3, 3, 3, 3, 3, 4]), 400), 'degraded')
	})

	it('never downgrades an observation that already failed', () => {
		const baseline = withHistory([100, 105, 98, 102, 101, 99])
		const judged = judgeMeasurements([observation('fail', [ms(900)])], baseline)[0]

		assert.equal(judged?.verdict, 'fail')
		assert.equal(judged?.reason, 'because')
	})

	it('leaves an observation that measured nothing alone', () => {
		const judged = judgeMeasurements([observation('pass', [])], withHistory([1, 1, 1, 1, 1, 1]))[0]
		assert.equal(judged?.verdict, 'pass')
	})
})

describe('recordMeasurements', () => {
	it('appends this run to the history', () => {
		const recorded = recordMeasurements([observation('pass', [ms(120)])], withHistory([100, 110]))
		assert.deepEqual(recorded.series['x.latency|response|/health']?.samples, [100, 110, 120])
	})

	it('keeps the window bounded, dropping the oldest', () => {
		const long = Array.from({ length: 20 }, (_, index) => index)
		const recorded = recordMeasurements([observation('pass', [ms(99)])], withHistory(long))
		const samples = recorded.series['x.latency|response|/health']?.samples ?? []

		assert.equal(samples.length, 20)
		assert.equal(samples.at(0), 1)
		assert.equal(samples.at(-1), 99)
	})

	it('refuses to fold in the number it just complained about', () => {
		// `degraded` is not red, so the run-level guard does not stop a recording.
		// Folding the value in would raise the mean toward the regression until the
		// verdict stopped firing — the alarm teaching itself to go quiet.
		const recorded = recordMeasurements(
			[observation('degraded', [ms(900)])],
			withHistory([100, 105]),
		)
		assert.deepEqual(recorded.series['x.latency|response|/health']?.samples, [100, 105])
	})

	it('ignores a failing observation entirely', () => {
		const recorded = recordMeasurements([observation('fail', [ms(900)])], withHistory([100, 105]))
		assert.deepEqual(recorded.series['x.latency|response|/health']?.samples, [100, 105])
	})

	it('starts a series for a measurement it has not seen', () => {
		const recorded = recordMeasurements([observation('pass', [ms(7)])], emptyBaseline())
		assert.deepEqual(recorded.series['x.latency|response|/health']?.samples, [7])
	})
})

describe('loadBaseline', () => {
	it('is empty when there is no file', () => {
		assert.deepEqual(loadBaseline('/nonexistent/baseline.json'), emptyBaseline())
	})

	it('is empty rather than fatal when the file is corrupt', () => {
		// The worst a corrupt baseline can cost is the history. A run that refuses
		// to start because of it costs the run.
		const path = join(mkdtempSync(join(tmpdir(), 'houndbot-')), 'baseline.json')
		writeFileSync(path, '{ not json', 'utf8')

		assert.deepEqual(loadBaseline(path), emptyBaseline())
	})
})
