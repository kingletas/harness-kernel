import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { candidates, forgetCheck, loadFlakes, saveFlakes } from '../../history/flake.js'
import type { Harness } from '../harness.js'

/**
 * The ledgers on disk rather than the targets the registry knows about, because
 * the selfcheck stub keeps a history and is in no registry.
 */
export const flakeLedgers = (harness: Harness): readonly string[] => {
	const ledger = harness.workspace.ledger
	return existsSync(ledger)
		? readdirSync(ledger)
				.filter(file => file.endsWith('.flake.json'))
				.map(file => file.replace(/\.flake\.json$/, ''))
				.sort()
		: []
}

/**
 * Drops one check's history, for what an arranged run taught. An id no ledger
 * holds is an error: a quiet success would leave the history in place.
 */
export const forgetFlakes = (harness: Harness, id: string, only: string | undefined): number => {
	const ledger = harness.workspace.ledger
	let forgotten = 0

	for (const name of flakeLedgers(harness)) {
		if (only !== undefined && only !== name) continue

		const path = join(ledger, `${name}.flake.json`)
		const before = loadFlakes(path)
		const result = forgetCheck(before, id)
		if (!result.forgotten) continue

		saveFlakes(path, result.flakes)
		forgotten += 1
		process.stdout.write(
			`  forgot ${id} — ${before.checks[id]?.outcomes.length ?? 0} run(s) of history dropped from ${name}\n`,
		)
	}

	if (forgotten === 0) {
		process.stderr.write(
			`${harness.name}: no ledger holds a history for "${id}"${only === undefined ? '' : ` under ${only}`}\n` +
				`  ${harness.name} flakes lists what is inconsistent; the ledger holds every check that has ever run\n`,
		)
		return 2
	}

	return 0
}

export const listFlakes = (harness: Harness, only: string | undefined): number => {
	let found = 0
	const ledger = harness.workspace.ledger

	for (const name of flakeLedgers(harness)) {
		if (only !== undefined && only !== name) continue

		for (const candidate of candidates(loadFlakes(join(ledger, `${name}.flake.json`)))) {
			found += 1
			process.stdout.write(
				`  ${candidate.id}: ${candidate.failures}/${candidate.runs} runs not passing ` +
					`(${Math.round(candidate.rate * 100)}%)${candidate.rescuedByRetry ? ', retry has rescued it' : ''}\n`,
			)
		}
	}

	if (found === 0) process.stdout.write('  no check has an inconsistent history\n')
	return 0
}
