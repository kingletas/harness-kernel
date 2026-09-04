import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { digest, readReports } from '../../src/history/schedule.js'

/** A results directory with one report per run, which is what a real one is. */
const results = (
	runs: readonly { id: string; at: string; target?: string; red?: boolean; failing?: string[] }[],
): string => {
	const root = mkdtempSync(join(tmpdir(), 'results-'))
	for (const run of runs) {
		mkdirSync(join(root, run.id), { recursive: true })
		writeFileSync(
			join(root, run.id, 'report.json'),
			JSON.stringify({
				run: {
					id: run.id,
					seed: 'x',
					target: run.target ?? 'nemesis',
					environment: 'local',
					suites: ['smoke'],
					startedAt: run.at,
					build: 'unknown',
				},
				summary: { red: run.red ?? false },
				observations: (run.failing ?? []).map(id => ({ id, verdict: 'fail' })),
			}),
			'utf8',
		)
	}
	return root
}

describe('what the schedule has been doing', () => {
	it('finds the longest stretch with no run, which is how a stopped timer shows up', () => {
		const root = results([
			{ id: 'a', at: '2026-09-01T02:00:00.000Z' },
			{ id: 'b', at: '2026-09-02T02:00:00.000Z' },
			{ id: 'c', at: '2026-09-06T02:00:00.000Z' },
			{ id: 'd', at: '2026-09-07T02:00:00.000Z' },
		])

		const [window] = digest(readReports(root))
		assert.equal(window?.runs, 4)
		assert.equal(window?.longestGapMs, 4 * 86_400_000)
		assert.equal(window?.lastAt, '2026-09-07T02:00:00.000Z')
	})

	it('keeps each target apart, so a busy one cannot cover for a stopped one', () => {
		const root = results([
			{ id: 'a', at: '2026-09-01T02:00:00.000Z', target: 'nemesis' },
			{ id: 'b', at: '2026-09-07T02:00:00.000Z', target: 'magento' },
		])

		assert.deepEqual(
			digest(readReports(root))
				.map(window => window.target)
				.sort(),
			['magento', 'nemesis'],
		)
	})

	it('counts how often each check was not passing, most often first', () => {
		const root = results([
			{ id: 'a', at: '2026-09-01T02:00:00.000Z', red: true, failing: ['x', 'y'] },
			{ id: 'b', at: '2026-09-02T02:00:00.000Z', red: true, failing: ['x'] },
		])

		const [window] = digest(readReports(root))
		assert.equal(window?.red, 2)
		assert.deepEqual(window?.failing[0], { id: 'x', runs: 2 })
	})

	it('leaves out what nobody can act on', () => {
		// unsupported is a statement about the target's capabilities and quarantined
		// is a decision somebody already made; either would head the list for ever.
		const root = mkdtempSync(join(tmpdir(), 'results-'))
		mkdirSync(join(root, 'a'), { recursive: true })
		writeFileSync(
			join(root, 'a', 'report.json'),
			JSON.stringify({
				run: {
					id: 'a',
					seed: 'x',
					target: 'nemesis',
					environment: 'local',
					suites: ['smoke'],
					startedAt: '2026-09-07T02:00:00.000Z',
					build: 'unknown',
				},
				summary: { red: true },
				observations: [
					{ id: 'no-browser', verdict: 'unsupported' },
					{ id: 'held-out', verdict: 'quarantined' },
					{ id: 'really-broken', verdict: 'fail' },
				],
			}),
			'utf8',
		)

		const [window] = digest(readReports(root))
		assert.deepEqual(window?.failing, [{ id: 'really-broken', runs: 1 }])
	})

	it('reads only the window it was asked for', () => {
		const root = results([
			{ id: 'old', at: '2026-08-01T02:00:00.000Z' },
			{ id: 'new', at: '2026-09-07T02:00:00.000Z' },
		])

		assert.equal(readReports(root, new Date('2026-09-01T00:00:00.000Z')).length, 1)
	})

	it('walks past a report it cannot read rather than reporting nothing at all', () => {
		// One truncated file must not take the whole week's answer with it.
		const root = results([{ id: 'good', at: '2026-09-07T02:00:00.000Z' }])
		mkdirSync(join(root, 'broken'), { recursive: true })
		writeFileSync(join(root, 'broken', 'report.json'), '{"run":', 'utf8')
		mkdirSync(join(root, 'notarun'), { recursive: true })
		writeFileSync(join(root, 'notarun', 'report.json'), '{"run":{}}', 'utf8')

		assert.equal(readReports(root).length, 1)
	})

	it('says nothing rather than throwing when nothing has ever run', () => {
		assert.deepEqual(readReports(join(tmpdir(), 'no-such-results-dir')), [])
		assert.deepEqual(digest([]), [])
	})
})
