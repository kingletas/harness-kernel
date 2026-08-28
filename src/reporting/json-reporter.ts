import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Observation } from '../kernel/observation.js'
import type { RunIdentity } from '../kernel/run.js'
import type { Summary } from './summary.js'

export interface RunReport {
	readonly run: RunIdentity
	readonly summary: Omit<Summary, 'newly'> & { readonly newly: readonly string[] }
	readonly observations: readonly Observation[]
}

/** Writes the whole run, including everything the console stayed quiet about. */
export const writeJsonReport = (
	path: string,
	run: RunIdentity,
	observations: readonly Observation[],
	summary: Summary,
): RunReport => {
	const report: RunReport = {
		run,
		summary: { ...summary, newly: summary.newly.map(observation => observation.id) },
		observations,
	}

	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(report, null, '\t')}\n`, 'utf8')
	return report
}
