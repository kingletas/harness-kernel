import { join } from 'node:path'
import type { Capabilities } from '../kernel/capabilities.js'
import { defaultEnvironment, type CheckDefinition } from '../kernel/check.js'
import { buildMatrix, type Area } from '../kernel/areas.js'
import type { DriftRecorder } from '../history/drift.js'
import { judgeDrift, loadDrift, recordDrift, saveDrift } from '../history/drift.js'
import { candidates, loadFlakes, recordOutcomes, saveFlakes } from '../history/flake.js'
import { ArtefactStore } from '../kernel/artefacts.js'
import { Journal } from '../kernel/journal.js'
import type { Observation } from '../kernel/observation.js'
import { Quarantine } from '../history/quarantine.js'
import type { RunIdentity } from '../kernel/run.js'
import { runChecks } from '../kernel/runner.js'
import {
	judgeMeasurements,
	loadBaseline,
	recordMeasurements,
	saveBaseline,
} from '../history/measurements.js'
import { reportToConsole } from '../reporting/console-reporter.js'
import { renderMatrix, writeMatrix } from '../reporting/matrix-reporter.js'
import { writeJsonReport } from '../reporting/json-reporter.js'
import { readSignature, writeSignature } from '../history/signature.js'
import { summarize } from '../reporting/summary.js'
import type { Options } from './options.js'
import type { Harness } from './harness.js'

/**
 * What a --no-record run leaves untouched: history a *later* run reads back,
 * which is what puts the journal and the report outside the list.
 */
export const spared = (hasSelectors: boolean): string => {
	const names = [
		'the signature',
		'the measurement baseline',
		...(hasSelectors ? ['the selector drift ledger'] : []),
		'the flake ledger',
	]
	return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * The one path every run takes, preflighting first and on its own so a target
 * that is down costs one blocked observation rather than a suite of red.
 */
export const execute = async (
	harness: Harness,
	run: RunIdentity,
	checks: readonly CheckDefinition[],
	capabilities: Capabilities,
	options: Options,
	preflight?: Observation,
	recorder?: DriftRecorder,
	areas: readonly Area[] = [],
): Promise<number> => {
	// Said out loud green or not, like a narrowed run: an experiment and a real
	// run must never produce output a person could mistake for each other.
	if (!options.record) {
		process.stdout.write(
			`\n  no-record: this run teaches nothing — ${spared(recorder !== undefined)} are all unchanged\n` +
				`  its journal and report are still written; they are this run's own, and no later run reads them\n`,
		)
	}

	// Said out loud for the same reason --no-record is: a run whose checks
	// interleave is a different kind of run, and its timings are not evidence
	// about the target the way a sequential run's are.
	if (options.workers > 1) {
		process.stdout.write(
			`\n  workers: ${options.workers} — checks interleave, so measurements are neither judged\n` +
				'  nor recorded; a number taken while the harness is loading the target is not\n' +
				'  comparable with one taken alone\n',
		)
	}

	const journal = Journal.at(join(harness.workspace.results, run.id, 'journal.jsonl'))
	journal.append({ kind: 'run-started', run })

	const quarantinePath = join(harness.workspace.ledger, 'quarantine.json')
	// Evidence lands beside the run's own journal, and the budget is the run's
	// rather than the check's: no single check can see the total, and a suite
	// failing everywhere is exactly when the files are largest.
	const environment = defaultEnvironment(run, capabilities, {
		quarantine: Quarantine.load(quarantinePath),
		artefacts: new ArtefactStore(join(harness.workspace.results, run.id)),
	})

	const raw: Observation[] = []
	if (preflight !== undefined) {
		raw.push(preflight)
		journal.append({ kind: 'observation', observation: preflight })
	}

	if (preflight?.verdict !== 'blocked') {
		raw.push(...(await runChecks(checks, environment, { journal, concurrency: options.workers })))
	}

	const scope = [...run.suites].sort().join('+')
	const stem = join(harness.workspace.baselines, `${run.target}--${run.environment}--${scope}`)
	const measurements = loadBaseline(`${stem}.measurements.json`)

	// Judged after the checks have all run, so a slow measurement is a verdict on
	// an observation that otherwise passed rather than something a check body has
	// to know how to decide for itself.
	const driftPath = join(harness.workspace.ledger, `${run.target}.drift.json`)
	const drift = loadDrift(driftPath)

	const alone = options.workers === 1
	const observations = [
		...(alone ? judgeMeasurements(raw, measurements) : raw),
		...(recorder === undefined
			? []
			: judgeDrift(recorder, drift, {
					target: run.target,
					runId: run.id,
					startedAt: run.startedAt,
				})),
	]
	const policy = { degradedIsRed: options.degradedIsRed }
	const summary = summarize(observations, readSignature(`${stem}.signature`), policy)

	reportToConsole(run, observations, summary, { verbose: options.verbose })
	writeJsonReport(
		join(harness.workspace.results, run.id, 'report.json'),
		run,
		observations,
		summary,
	)

	if (areas.length > 0) {
		// Written every run and printed only when asked: a sign-off sheet is an
		// artefact somebody reads deliberately, and a wall of green after every
		// run is what the silence contract exists to prevent.
		const rows = buildMatrix(areas, observations)
		writeMatrix(join(harness.workspace.results, run.id, 'matrix'), run, rows)
		if (options.matrix) renderMatrix(rows, line => process.stdout.write(`${line}\n`))
	}
	journal.append({ kind: 'run-finished', at: new Date().toISOString(), red: summary.red })

	// Recorded whatever the run did, unlike the baselines below: a failure is the
	// observation being counted here. The proposal is suppressed with the ledger
	// rather than kept, since the history behind it would not be there.
	if (options.record) {
		const flakePath = join(harness.workspace.ledger, `${run.target}.flake.json`)
		const before = new Set(candidates(loadFlakes(flakePath)).map(candidate => candidate.id))
		const flakes = recordOutcomes(observations, loadFlakes(flakePath))
		saveFlakes(flakePath, flakes)

		const fresh = candidates(flakes).filter(candidate => !before.has(candidate.id))
		for (const candidate of fresh) {
			process.stdout.write(
				`\n  ${candidate.id} has not passed ${candidate.failures} of its last ${candidate.runs} runs ` +
					`(${Math.round(candidate.rate * 100)}%)${candidate.rescuedByRetry ? ', and a retry has rescued it' : ''}.\n` +
					`  Fix it, or quarantine it: houndbot quarantine add ${candidate.id} --reason "..." --days 14\n` +
					`  History that should not have been kept: houndbot flakes --forget ${candidate.id}\n`,
			)
		}
	}

	// Neither history moves on a red run. Recording a failure as the new normal is
	// how a suite talks itself into silence about it, and recording a broken run's
	// timings teaches the baseline to accept the breakage.
	if (options.record && !summary.red) {
		writeSignature(`${stem}.signature`, summary.signature)
		// Only a run that had the target to itself contributes a timing. Folding
		// in a number measured while the harness was loading the target teaches
		// the baseline to accept slowness, which is the alarm turning itself off.
		if (alone) {
			saveBaseline(`${stem}.measurements.json`, recordMeasurements(observations, measurements))
		}
		if (recorder !== undefined) saveDrift(driftPath, recordDrift(recorder, drift))
	}

	return summary.red ? 1 : 0
}
