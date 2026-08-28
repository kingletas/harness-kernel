import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { startStub, type Defect } from '../fixtures/stub-target.js'
import { NO_CAPABILITIES } from '../src/kernel/capabilities.js'
import { defaultEnvironment } from '../src/kernel/check.js'
import { CircuitBreaker } from '../src/kernel/circuit.js'
import { retryPolicy } from '../src/kernel/retry.js'
import { startRun } from '../src/kernel/run.js'
import { runChecks } from '../src/kernel/runner.js'
import { reportToConsole } from '../src/reporting/console-reporter.js'
import { summarize } from '../src/reporting/summary.js'
import { selfcheckChecks } from '../selfcheck/checks.js'

const against = async (defect: Defect, circuit = new CircuitBreaker()) => {
	const stub = await startStub(defect)
	try {
		const run = startRun({
			target: 'stub',
			environment: 'local',
			suites: ['selfcheck'],
			seed: 'fixed',
		})
		const environment = defaultEnvironment(run, NO_CAPABILITIES, {
			circuit,
			retry: retryPolicy({ baseDelayMs: 0 }),
			sleep: async () => undefined,
		})

		const observations = await runChecks(selfcheckChecks(stub.url), environment)
		return { run, observations, summary: summarize(observations) }
	} finally {
		await stub.close()
	}
}

const verdictOf = (observations: readonly { id: string; verdict: string }[], id: string): string =>
	observations.find(observation => observation.id === id)?.verdict ?? 'missing'

const rendered = (
	run: Parameters<typeof reportToConsole>[0],
	observations: Parameters<typeof reportToConsole>[1],
	previous = '',
): string[] => {
	const lines: string[] = []
	reportToConsole(run, observations, summarize(observations, previous), {
		colour: false,
		write: line => lines.push(line),
	})
	return lines
}

describe('the harness against a healthy target', () => {
	it('passes everything it can run, and asks for nothing it cannot', async () => {
		const { observations, summary } = await against('none')

		assert.equal(summary.red, false)
		assert.equal(verdictOf(observations, 'selfcheck.session-less-read'), 'pass')
		assert.equal(verdictOf(observations, 'selfcheck.browser-only'), 'unsupported')
	})

	it('is silent on the second run, once the known exception is established', async () => {
		// The quiet path, asserted directly. A green run that still prints a summary
		// teaches the reader to skim, and the skim is still there on the morning the
		// summary is not green.
		const first = await against('none')
		const second = await against('none')

		assert.deepEqual(rendered(second.run, second.observations, first.summary.signature), [])
	})

	it('records the build it saw', async () => {
		const { observations } = await against('none')
		const health = observations.find(observation => observation.id === 'selfcheck.health')

		assert.deepEqual(health?.evidence, [{ label: 'build', detail: 'stub-1' }])
	})
})

describe('the harness against a defective target', () => {
	it('finds a read surface that answers a caller with no credentials', async () => {
		const { run, observations, summary } = await against('session-less-read')

		assert.equal(verdictOf(observations, 'selfcheck.session-less-read'), 'fail')
		assert.equal(summary.red, true)

		// The loud path is exactly as narrow as the quiet path is silent: one
		// defect produces one line, not a wall.
		const failures = rendered(run, observations).filter(line => line.includes('FAIL'))
		assert.equal(failures.length, 1)
		assert.match(failures[0] ?? '', /selfcheck\.session-less-read/)
	})

	it('reports a route that only failed the first time as flaky, not as passing', async () => {
		const { observations, summary } = await against('intermittent')

		assert.equal(verdictOf(observations, 'selfcheck.intermittent'), 'flaky')
		assert.equal(summary.red, false)
	})

	it('measures how long a slow route took', async () => {
		const { observations } = await against('slow')
		const latency = observations.find(observation => observation.id === 'selfcheck.latency')

		assert.equal(latency?.verdict, 'pass')
		assert.ok((latency?.measurements[0]?.value ?? 0) >= 200)
	})

	it('collapses an unreachable target into one blocked run rather than a wall of failures', async () => {
		const { observations, summary } = await against('refuses-connections', new CircuitBreaker(2))

		assert.equal(summary.counts.fail, 2)
		assert.ok(summary.counts.blocked >= 1)
		assert.equal(verdictOf(observations, 'selfcheck.browser-only'), 'unsupported')
	})
})
