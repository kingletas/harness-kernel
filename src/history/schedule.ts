import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RunReport } from '../reporting/json-reporter.js'
import { isSteadyState } from '../kernel/verdict.js'

/** What one target has been doing over a window, which is what a weekly read is for. */
export interface ScheduleWindow {
	readonly target: string
	readonly environment: string
	readonly runs: number
	readonly red: number
	readonly firstAt: string
	readonly lastAt: string
	/** The longest stretch with no run, which is how a schedule that stopped firing shows up. */
	readonly longestGapMs: number
	/** Checks that actually went wrong, most often first. */
	readonly failing: readonly { readonly id: string; readonly runs: number }[]
}

/** Every run report under a results directory, newest last, ignoring anything unreadable. */
export const readReports = (results: string, since?: Date): readonly RunReport[] => {
	if (!existsSync(results)) return []

	const reports: RunReport[] = []
	for (const entry of readdirSync(results)) {
		const path = join(results, entry, 'report.json')
		if (!existsSync(path)) continue

		try {
			const report = JSON.parse(readFileSync(path, 'utf8')) as RunReport
			// A run with no start is a report written by something else, not a run
			// this can say anything about.
			if (typeof report.run?.startedAt !== 'string') continue
			if (since !== undefined && new Date(report.run.startedAt) < since) continue
			reports.push(report)
		} catch {
			continue
		}
	}

	return reports.sort((left, right) => left.run.startedAt.localeCompare(right.run.startedAt))
}

const gapOf = (times: readonly number[]): number => {
	let longest = 0
	for (let index = 1; index < times.length; index += 1) {
		longest = Math.max(longest, (times[index] ?? 0) - (times[index - 1] ?? 0))
	}
	return longest
}

/**
 * Groups runs by what they were run against. Each target is its own schedule, so
 * a busy one must never make a stopped one look like it is still firing.
 */
export const digest = (reports: readonly RunReport[]): readonly ScheduleWindow[] => {
	const groups = new Map<string, RunReport[]>()
	for (const report of reports) {
		const key = `${report.run.target}--${report.run.environment}`
		const held = groups.get(key)
		if (held === undefined) groups.set(key, [report])
		else held.push(report)
	}

	return [...groups.values()].map(group => {
		const first = group[0] as RunReport
		const last = group.at(-1) as RunReport
		const failing = new Map<string, number>()

		for (const report of group) {
			for (const observation of report.observations) {
				// A check the target cannot support, or one held out on purpose, would
				// otherwise head this list for ever with nothing anybody can do about it.
				if (isSteadyState(observation.verdict)) continue
				failing.set(observation.id, (failing.get(observation.id) ?? 0) + 1)
			}
		}

		return {
			target: first.run.target,
			environment: first.run.environment,
			runs: group.length,
			red: group.filter(report => report.summary.red).length,
			firstAt: first.run.startedAt,
			lastAt: last.run.startedAt,
			longestGapMs: gapOf(group.map(report => new Date(report.run.startedAt).getTime())),
			failing: [...failing.entries()]
				.map(([id, runs]) => ({ id, runs }))
				.sort((left, right) => right.runs - left.runs),
		}
	})
}
