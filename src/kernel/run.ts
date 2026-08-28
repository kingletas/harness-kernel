import { freshSeed } from './seed.js'

/** Who is being asked, in what state, with what seed. */
export interface RunIdentity {
	readonly id: string
	/** Replays the run's random choices. Printed in every report. */
	readonly seed: string
	readonly target: string
	readonly environment: string
	readonly suites: readonly string[]
	readonly startedAt: string
	/** What the target was running, learned at preflight; `unknown` rather than omitted. */
	readonly build: string
}

export interface RunOptions {
	readonly target: string
	readonly environment: string
	readonly suites: readonly string[]
	readonly seed?: string
	readonly now?: Date
}

const stamp = (date: Date): string =>
	date
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d+Z$/, 'Z')

/**
 * Starts a run whose id carries the timestamp, keeping the seed separate so a
 * replay reproduces the choices without pretending to be the same run.
 */
export const startRun = (options: RunOptions): RunIdentity => {
	const now = options.now ?? new Date()
	const seed = options.seed ?? freshSeed()

	return {
		id: `${stamp(now)}-${seed}`,
		seed,
		target: options.target,
		environment: options.environment,
		suites: options.suites,
		startedAt: now.toISOString(),
		build: 'unknown',
	}
}

/** Records what preflight learned about the target. */
export const withBuild = (run: RunIdentity, build: string): RunIdentity => ({ ...run, build })
