import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { matrixToCsv, type AreaRow } from '../kernel/areas.js'
import type { RunIdentity } from '../kernel/run.js'

const MARK: Readonly<Record<AreaRow['status'], string>> = {
	Passed: '🟢',
	Failed: '🔴',
	Degraded: '🟡',
	Flaky: '🟣',
	Quarantined: '🔵',
	Pending: '🟠',
	Unsupported: '⚪',
	'Not Run': '⚫',
	'Not Implemented': '⚪',
	Deprecated: '⚫',
}

/** Writes the sheet back out filled in, in the shape a tracker would take. */
export const writeMatrix = (stem: string, run: RunIdentity, rows: readonly AreaRow[]): void => {
	mkdirSync(dirname(stem), { recursive: true })
	writeFileSync(`${stem}.csv`, matrixToCsv(rows), 'utf8')
	writeFileSync(`${stem}.json`, `${JSON.stringify({ run, rows }, null, '\t')}\n`, 'utf8')
}

/**
 * Renders the sheet for a person, printed only when asked: a wall of green
 * after every run is what the silence contract exists to prevent.
 */
export const renderMatrix = (rows: readonly AreaRow[], write: (line: string) => void): void => {
	const width = Math.max(...rows.map(row => row.title.length))

	write('')
	for (const row of rows) {
		write(`  ${MARK[row.status]} ${row.title.padEnd(width)}  ${row.status}`)
		for (const notable of row.notable) write(`      ${notable}`)
		if (row.note !== undefined) write(`      ${row.note}`)
	}

	const covered = rows.filter(row => row.checks > 0).length
	write('')
	write(`  ${covered} of ${rows.length} areas covered by this run`)
	write('')
}
