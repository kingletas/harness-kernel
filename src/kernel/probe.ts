/** What one selector entry did when the probe asked for it. */
export interface ProbeFinding {
	readonly stage: string
	readonly entry: string
	readonly resolved: boolean
	/** The candidate that answered, or why nothing did. */
	readonly via: string
	/** Position in the candidate list. Undefined when nothing resolved. */
	readonly index?: number
	readonly of: number
	readonly matches: number
}

export interface ProbeReport {
	readonly target: string
	readonly baseUrl: string
	readonly findings: readonly ProbeFinding[]
	/** A stage the probe could not reach at all, so its entries were never asked. */
	readonly unreached: readonly { readonly stage: string; readonly why: string }[]
}

/**
 * Whether a suite could drive this site, reported and never asserted: a probe
 * that failed would be a gate, and a gate is not what you run first.
 */
export const probeSummary = (
	report: ProbeReport,
): { readonly resolved: number; readonly total: number; readonly falling: number } => ({
	resolved: report.findings.filter(finding => finding.resolved).length,
	total: report.findings.length,
	// Entries resolving on their last candidate are the interesting middle case:
	// they work today and are one theme change from not.
	falling: report.findings.filter(
		finding => finding.resolved && finding.index !== undefined && finding.index === finding.of - 1,
	).length,
})

/** Renders the report for a person deciding whether to point the suite here. */
export const renderProbe = (report: ProbeReport, write: (line: string) => void): void => {
	const stages = [...new Set(report.findings.map(finding => finding.stage))]

	write('')
	write(`  ${report.target} — ${report.baseUrl}`)

	for (const stage of stages) {
		const mine = report.findings.filter(finding => finding.stage === stage)
		const found = mine.filter(finding => finding.resolved).length
		write('')
		write(`  ${stage}  (${found}/${mine.length})`)

		for (const finding of mine) {
			const mark = finding.resolved ? '✓' : '✗'
			const position =
				finding.index === undefined ? '' : `  [${finding.index + 1} of ${finding.of}]`
			const count = finding.matches > 1 ? `  ×${finding.matches}` : ''
			write(`    ${mark} ${finding.entry.padEnd(18)} ${finding.via}${position}${count}`)
		}
	}

	for (const missed of report.unreached) {
		write('')
		write(`  ${missed.stage}  — not reached: ${missed.why}`)
	}

	const summary = probeSummary(report)
	write('')
	write(`  ${summary.resolved} of ${summary.total} entries resolved`)
	if (summary.falling > 0) {
		write(`  ${summary.falling} resolved on their last candidate — portable today, not tomorrow`)
	}
	write('')
}
