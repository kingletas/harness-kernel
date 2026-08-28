/** A path in the target's repository, and what changing it puts at risk. */
export interface ImpactRule {
	/** Matched against a repository-relative path. */
	readonly pattern: RegExp
	readonly areas: readonly string[]
	readonly why: string
}

export interface Selection {
	/** Areas a changed path put at risk. */
	readonly areas: readonly string[]
	/** Paths that matched no rule, so their impact is not known. */
	readonly unmapped: readonly string[]
	/** Whether to run everything anyway, true when a changed path matched no rule. */
	readonly runEverything: boolean
	readonly reason: string
}

/**
 * Works out what a diff put at risk, biased toward running too much: narrowing
 * wrongly reports green for code nobody tested.
 */
export const selectFrom = (changed: readonly string[], rules: readonly ImpactRule[]): Selection => {
	if (changed.length === 0) {
		return { areas: [], unmapped: [], runEverything: false, reason: 'nothing has changed' }
	}

	const areas = new Set<string>()
	const unmapped: string[] = []

	for (const path of changed) {
		const matched = rules.filter(rule => rule.pattern.test(path))
		if (matched.length === 0) {
			unmapped.push(path)
			continue
		}
		for (const rule of matched) for (const area of rule.areas) areas.add(area)
	}

	if (unmapped.length > 0) {
		return {
			areas: [...areas].sort(),
			unmapped,
			runEverything: true,
			reason: `${unmapped.length} changed path(s) match no impact rule, so the map is incomplete`,
		}
	}

	return {
		areas: [...areas].sort(),
		unmapped: [],
		runEverything: false,
		reason: `${changed.length} changed path(s) put ${areas.size} area(s) at risk`,
	}
}
