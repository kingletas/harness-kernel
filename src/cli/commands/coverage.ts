import { coverageProblems } from '../../kernel/areas.js'
import type { Harness } from '../harness.js'

/**
 * Reports where the sheet and the checks disagree, because a sheet nobody
 * notices a gap in is worse than none — it is read as coverage.
 */
export const checkCoverage = (harness: Harness, only: string | undefined): number => {
	let problems = 0

	for (const name of harness.registry.names()) {
		if (only !== undefined && only !== name) continue

		const target = harness.registry.named(name)
		const checks = [...target.suites().values()].flat()
		const found = coverageProblems(target.areas(), checks)

		for (const problem of found) {
			process.stdout.write(`  ${name}: ${problem.subject} ${problem.detail}\n`)
		}
		problems += found.length

		const uncovered = target.areas().filter(area => area.uncovered !== undefined)
		for (const area of uncovered) {
			process.stdout.write(`  ${name}: ${area.id} is uncovered — ${area.uncovered?.note ?? ''}\n`)
		}
	}

	return problems === 0 ? 0 : 1
}
