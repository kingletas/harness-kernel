import type { Observation } from './observation.js'
import { worse, type Verdict } from './verdict.js'

/**
 * One row of a release sign-off sheet, declared separately from the checks so
 * that a gap is something the report states rather than nobody notices.
 */
export interface Area {
	readonly id: string
	readonly title: string
	/** Why this area has no checks yet; without one it fails the coverage check. */
	readonly uncovered?: {
		readonly why: 'planned' | 'deprecated' | 'unsupported'
		readonly note: string
	}
}

/** What a row of the matrix says after a run. */
export type AreaStatus =
	| 'Passed'
	| 'Failed'
	| 'Degraded'
	| 'Flaky'
	| 'Quarantined'
	| 'Pending'
	| 'Unsupported'
	| 'Not Run'
	| 'Not Implemented'
	| 'Deprecated'

export interface AreaRow {
	readonly area: string
	readonly title: string
	readonly status: AreaStatus
	readonly checks: number
	/** Ids of the checks that were not clean, so a failure names itself. */
	readonly notable: readonly string[]
	readonly note?: string
}

export interface CoverageProblem {
	readonly kind: 'area-has-no-checks' | 'check-names-no-area' | 'check-names-unknown-area'
	readonly subject: string
	readonly detail: string
}

/**
 * Checks whether the declared areas and the declared checks agree, since each
 * of the three ways they can disagree empties a row nobody would notice.
 */
export const coverageProblems = (
	areas: readonly Area[],
	checks: readonly { readonly id: string; readonly area?: string }[],
): readonly CoverageProblem[] => {
	const declared = new Map(areas.map(area => [area.id, area]))
	const covered = new Set(
		checks.map(check => check.area).filter((id): id is string => id !== undefined),
	)
	const problems: CoverageProblem[] = []

	for (const area of areas) {
		if (covered.has(area.id) || area.uncovered !== undefined) continue
		problems.push({
			kind: 'area-has-no-checks',
			subject: area.id,
			detail: `"${area.title}" has no checks and does not say why`,
		})
	}

	for (const check of checks) {
		if (check.area === undefined) {
			problems.push({
				kind: 'check-names-no-area',
				subject: check.id,
				detail: 'names no area, so it cannot appear on the sheet',
			})
			continue
		}
		if (!declared.has(check.area)) {
			problems.push({
				kind: 'check-names-unknown-area',
				subject: check.id,
				detail: `names the area "${check.area}", which is not declared`,
			})
		}
	}

	return problems
}

const STATUS_OF: Readonly<Record<Verdict, AreaStatus>> = {
	pass: 'Passed',
	fail: 'Failed',
	degraded: 'Degraded',
	flaky: 'Flaky',
	quarantined: 'Quarantined',
	blocked: 'Pending',
	unsupported: 'Unsupported',
	skipped: 'Pending',
}

/**
 * Fills the sheet in from a run, each area taking the worst verdict of its
 * checks so one failure makes the row read Failed.
 */
export const buildMatrix = (
	areas: readonly Area[],
	observations: readonly Observation[],
): readonly AreaRow[] =>
	areas.map((area): AreaRow => {
		if (area.uncovered !== undefined) {
			return {
				area: area.id,
				title: area.title,
				status: area.uncovered.why === 'deprecated' ? 'Deprecated' : 'Not Implemented',
				checks: 0,
				notable: [],
				note: area.uncovered.note,
			}
		}

		const mine = observations.filter(observation => observation.area === area.id)
		if (mine.length === 0) {
			return {
				area: area.id,
				title: area.title,
				status: 'Not Run',
				checks: 0,
				notable: [],
				note: 'this run did not include it',
			}
		}

		// Worst-wins, but only among verdicts that are a judgement: `unsupported`
		// and `skipped` are absences, and a row reading Unsupported for an area
		// where nine checks passed says the opposite of what happened.
		const judged = mine.filter(
			observation => observation.verdict !== 'unsupported' && observation.verdict !== 'skipped',
		)
		const verdict =
			judged.length > 0
				? judged.reduce<Verdict>((held, observation) => worse(held, observation.verdict), 'pass')
				: mine.reduce<Verdict>((held, observation) => worse(held, observation.verdict), 'skipped')

		return {
			area: area.id,
			title: area.title,
			status: STATUS_OF[verdict],
			checks: mine.length,
			notable: mine
				.filter(observation => observation.verdict !== 'pass')
				.map(observation => `${observation.id} — ${observation.verdict}`),
		}
	})

/** The sheet as CSV, with the same columns a tracker would have. */
export const matrixToCsv = (rows: readonly AreaRow[]): string => {
	const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`
	const lines = [['Area', 'Title', 'Status', 'Checks', 'Detail'].join(',')]

	for (const row of rows) {
		lines.push(
			[
				escape(row.area),
				escape(row.title),
				escape(row.status),
				String(row.checks),
				escape(row.notable.join('; ') || row.note || ''),
			].join(','),
		)
	}

	return `${lines.join('\n')}\n`
}
