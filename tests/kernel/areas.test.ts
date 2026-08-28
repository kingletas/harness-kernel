import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildMatrix, coverageProblems, matrixToCsv, type Area } from '../../src/kernel/areas.js'
import { observe, type Observation } from '../../src/kernel/observation.js'
import type { Verdict } from '../../src/kernel/verdict.js'

const at = (id: string, area: string | undefined, verdict: Verdict): Observation =>
	observe({
		id,
		title: id,
		suite: 't',
		...(area === undefined ? {} : { area }),
		target: 'stub',
		runId: 'run-1',
		verdict,
		...(verdict === 'pass' ? {} : { reason: 'because' }),
		durationMs: 1,
		startedAt: '2026-08-27T00:00:00.000Z',
	})

const AREAS: readonly Area[] = [
	{ id: 'cart', title: 'Cart' },
	{ id: 'checkout', title: 'Checkout', uncovered: { why: 'planned', note: 'no sandbox gateway' } },
	{ id: 'legacy', title: 'Legacy', uncovered: { why: 'deprecated', note: 'removed in 2.4' } },
]

describe('coverageProblems', () => {
	it('is silent when every area is covered or says why it is not', () => {
		assert.deepEqual(coverageProblems(AREAS, [{ id: 'a', area: 'cart' }]), [])
	})

	it('catches an area with no checks and no reason', () => {
		// A row nobody is filling in, on a sheet that will be read as coverage.
		const problems = coverageProblems([{ id: 'cart', title: 'Cart' }], [])

		assert.equal(problems.length, 1)
		assert.equal(problems[0]?.kind, 'area-has-no-checks')
		assert.match(problems[0]?.detail ?? '', /does not say why/)
	})

	it('catches a check that names no area', () => {
		// It runs, it passes or fails, and it appears on no sheet — so its result
		// is invisible to the only summary anyone reads.
		const orphan = coverageProblems(AREAS, [{ id: 'orphan' }]).find(
			problem => problem.kind === 'check-names-no-area',
		)

		assert.equal(orphan?.subject, 'orphan')
	})

	it('catches a check that names an area nobody declared', () => {
		const typo = coverageProblems(AREAS, [{ id: 'typo', area: 'chekout' }]).find(
			problem => problem.kind === 'check-names-unknown-area',
		)

		assert.match(typo?.detail ?? '', /"chekout"/)
	})

	it('reports every disagreement, not the first one it meets', () => {
		// A sheet with two gaps and a report naming one of them sends somebody
		// back for a second look they have no reason to expect.
		const problems = coverageProblems(
			[{ id: 'cart', title: 'Cart' }],
			[{ id: 'orphan' }, { id: 'typo', area: 'nowhere' }],
		)

		assert.deepEqual(problems.map(problem => problem.kind).sort(), [
			'area-has-no-checks',
			'check-names-no-area',
			'check-names-unknown-area',
		])
	})
})

describe('buildMatrix', () => {
	it('takes the worst verdict of an area, not the commonest', () => {
		// One failing check makes the row Failed however many pass beside it,
		// which is what a person signing off a release needs it to mean.
		const rows = buildMatrix(AREAS, [
			at('a', 'cart', 'pass'),
			at('b', 'cart', 'pass'),
			at('c', 'cart', 'fail'),
		])

		assert.equal(rows[0]?.status, 'Failed')
		assert.equal(rows[0]?.checks, 3)
		assert.deepEqual(rows[0]?.notable, ['c — fail'])
	})

	it('reports a declared gap as Not Implemented, with its reason', () => {
		const rows = buildMatrix(AREAS, [at('a', 'cart', 'pass')])

		assert.equal(rows[1]?.status, 'Not Implemented')
		assert.equal(rows[1]?.note, 'no sandbox gateway')
		assert.equal(rows[2]?.status, 'Deprecated')
	})

	it('tells an area that was filtered out from one that has no checks', () => {
		// Not Run and Not Implemented are different news: one is a choice about
		// this run, the other is a gap in the suite.
		const rows = buildMatrix([{ id: 'cart', title: 'Cart' }], [])

		assert.equal(rows[0]?.status, 'Not Run')
		assert.match(rows[0]?.note ?? '', /did not include it/)
	})

	it('maps every verdict to something a sheet can say', () => {
		for (const [verdict, expected] of [
			['degraded', 'Degraded'],
			['flaky', 'Flaky'],
			['quarantined', 'Quarantined'],
			['blocked', 'Pending'],
			['skipped', 'Pending'],
			['unsupported', 'Unsupported'],
		] as const) {
			const rows = buildMatrix([{ id: 'cart', title: 'Cart' }], [at('a', 'cart', verdict)])
			assert.equal(rows[0]?.status, expected, verdict)
		}
	})
})

describe('matrixToCsv', () => {
	it('escapes a quote rather than splitting the row', () => {
		const rows = buildMatrix([{ id: 'x', title: 'A "quoted" title' }], [at('a', 'x', 'pass')])
		const csv = matrixToCsv(rows)

		assert.match(csv, /"A ""quoted"" title"/)
		assert.equal(csv.trim().split('\n').length, 2)
	})
})
