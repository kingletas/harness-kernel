import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { observe, type Observation } from '../kernel/observation.js'

/** Which candidate answered for one selector entry, on one resolution. */
export interface Resolution {
	readonly entry: string
	/** Position in the candidate list. 0 is the most portable one. */
	readonly index: number
	readonly candidate: string
	/** The list as it stood, so history is never compared across an edit to it. */
	readonly candidates: readonly string[]
	/** How many elements it matched. More than one for a single control is drift too. */
	readonly matches: number
}

export interface DriftSeries {
	/** The candidate list as it was when these winners were recorded. */
	readonly candidates: readonly string[]
	/** Winning index per resolution, oldest first. */
	readonly winners: readonly number[]
}

export interface DriftFile {
	readonly version: 1
	readonly entries: Readonly<Record<string, DriftSeries>>
}

export const emptyDrift = (): DriftFile => ({ version: 1, entries: {} })

/**
 * Collects which candidate answered for every entry resolved in a run, because
 * an entry falling through to a theme-specific candidate still passes.
 */
export class DriftRecorder {
	private readonly seen: Resolution[] = []

	record(resolution: Resolution): void {
		this.seen.push(resolution)
	}

	/** Everything recorded since the last drain, for a caller that needs this resolution. */
	drain(): readonly Resolution[] {
		return this.seen.splice(0, this.seen.length)
	}

	/** The best (lowest) index reached for each entry this run. */
	best(): ReadonlyMap<string, Resolution> {
		const best = new Map<string, Resolution>()
		for (const resolution of this.seen) {
			const held = best.get(resolution.entry)
			if (held === undefined || resolution.index < held.index)
				best.set(resolution.entry, resolution)
		}
		return best
	}
}

export const loadDrift = (path: string): DriftFile => {
	if (!existsSync(path)) return emptyDrift()
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as DriftFile
	} catch {
		return emptyDrift()
	}
}

export const saveDrift = (path: string, drift: DriftFile): void => {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(drift, null, '\t')}\n`, 'utf8')
}

const sameList = (left: readonly string[], right: readonly string[]): boolean =>
	left.length === right.length && left.every((value, index) => value === right[index])

/**
 * Reports entries that answered on a later candidate than they used to, which
 * is never a failure; an edited candidate list is not judged until it has history.
 */
export const judgeDrift = (
	recorder: DriftRecorder,
	drift: DriftFile,
	context: { readonly target: string; readonly runId: string; readonly startedAt: string },
): readonly Observation[] => {
	const reported: Observation[] = []

	for (const [entry, resolution] of recorder.best()) {
		const series = drift.entries[entry]
		if (series === undefined || series.winners.length === 0) continue

		// History recorded against a different list is not comparable: index 2 in
		// the old list and index 2 in the new one are different selectors.
		if (!sameList(series.candidates, resolution.candidates)) continue

		const bestEver = Math.min(...series.winners)
		if (resolution.index <= bestEver) continue

		const previous = series.candidates[bestEver] ?? `candidate ${bestEver + 1}`
		reported.push(
			observe({
				id: `drift.${entry}`,
				title: `${entry} resolved on a later candidate than it used to`,
				suite: 'drift',
				target: context.target,
				runId: context.runId,
				verdict: 'degraded',
				reason:
					`${entry} answered on candidate ${resolution.index + 1} of ${series.candidates.length} ` +
					`("${resolution.candidate}") — it used to answer on candidate ${bestEver + 1} ("${previous}")`,
				evidence: [
					{
						label: 'still passing',
						detail: 'the entry resolved; this is the markup moving, not a failure',
					},
				],
				durationMs: 0,
				startedAt: context.startedAt,
			}),
		)
	}

	return reported
}

/**
 * Folds this run's winners into the ledger, starting again where the candidate
 * list has changed and index 2 no longer means what it did.
 */
export const recordDrift = (recorder: DriftRecorder, drift: DriftFile, window = 20): DriftFile => {
	const entries: Record<string, DriftSeries> = { ...drift.entries }

	for (const [entry, resolution] of recorder.best()) {
		const held = entries[entry]
		entries[entry] = {
			candidates: resolution.candidates,
			winners:
				held !== undefined && sameList(held.candidates, resolution.candidates)
					? [...held.winners, resolution.index].slice(-window)
					: [resolution.index],
		}
	}

	return { version: 1, entries }
}
