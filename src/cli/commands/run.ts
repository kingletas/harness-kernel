import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DriftRecorder } from '../../history/drift.js'
import { startRun, withBuild } from '../../kernel/run.js'
import { preflightObservation } from '../../kernel/runner.js'
import { selectFrom, type Selection } from '../../kernel/selection.js'
import type { Target } from '../../targets/target.js'
import type { Options } from '../options.js'
import { execute } from '../pipeline.js'
import type { Harness } from '../harness.js'

const run = promisify(execFile)

/** What has changed in the target's own repository; `HEAD` means uncommitted work. */
const changedPaths = async (repoDir: string, since: string): Promise<readonly string[]> => {
	const { stdout } = await run('git', ['diff', '--name-only', since], { cwd: repoDir })
	return stdout.split('\n').filter(line => line.trim().length > 0)
}

/**
 * What a diff put at risk, or undefined when the run was not narrowed — so the
 * caller can tell "not asked" from "asked, and the answer was everything".
 */
export const selectionFor = async (
	harness: Harness,
	target: Target,
	options: Options,
): Promise<Selection | undefined> => {
	if (!options.changed) return undefined

	const repoDir = target.repoDir
	const rules = target.impact?.()
	if (repoDir === undefined || rules === undefined) {
		process.stderr.write(
			`${harness.name}: ${target.name} declares no impact map, so --changed cannot narrow it\n`,
		)
		return {
			areas: [],
			unmapped: [],
			runEverything: true,
			reason: 'the target declares no impact map',
		}
	}

	return selectFrom(await changedPaths(repoDir, options.since), rules)
}

export const runAgainstTarget = async (harness: Harness, options: Options): Promise<number> => {
	if (options.target === undefined) {
		process.stderr.write(
			`${harness.name}: run needs --target. Known: ${harness.registry.names().join(', ')}\n`,
		)
		return 2
	}

	const recorder = new DriftRecorder()

	let target: Target
	try {
		target = harness.registry.named(options.target, {
			recorder,
			...(options.url ? { baseUrl: options.url } : {}),
			...(options.environment ? { environment: options.environment } : {}),
		})
	} catch (cause) {
		process.stderr.write(
			`${harness.name}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
		)
		return 2
	}

	const available = target.suites()
	const wanted = options.suites ?? [...available.keys()]
	const unknown = wanted.filter(name => !available.has(name))
	if (unknown.length > 0) {
		process.stderr.write(
			`${harness.name}: ${target.name} has no suite named ${unknown.join(', ')} — it offers ${[...available.keys()].join(', ')}\n`,
		)
		return 2
	}

	const result = await target.preflight()
	const run = withBuild(
		startRun({
			target: target.name,
			environment: target.environment,
			suites: wanted,
			...(options.seed === undefined ? {} : { seed: options.seed }),
		}),
		result.build,
	)

	const selection = await selectionFor(harness, target, options)
	const all = wanted.flatMap(name => available.get(name) ?? [])
	const checks =
		selection === undefined || selection.runEverything
			? all
			: all.filter(check => check.area !== undefined && selection.areas.includes(check.area))

	if (selection !== undefined) {
		// Said out loud green or not: a run that quietly narrows its own scope
		// reads exactly like one that tested everything.
		process.stdout.write(
			`\n  narrowed: ${selection.reason} — running ${checks.length} of ${all.length} checks\n`,
		)
		if (!selection.runEverything && selection.areas.length > 0) {
			process.stdout.write(`  areas: ${selection.areas.join(', ')}\n`)
		}
	}

	const preflight = preflightObservation(result, target.name, run.id, run.startedAt)

	try {
		return await execute(
			harness,
			run,
			checks,
			result.capabilities,
			options,
			preflight,
			recorder,
			target.areas(),
		)
	} finally {
		// A browser left running outlives the process that started it.
		await target.dispose?.()
	}
}
