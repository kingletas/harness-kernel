import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Observation } from './observation.js'
import type { RunIdentity } from './run.js'

export type JournalRecord =
	| { readonly kind: 'run-started'; readonly run: RunIdentity }
	| { readonly kind: 'observation'; readonly observation: Observation }
	| { readonly kind: 'run-finished'; readonly at: string; readonly red: boolean }

/**
 * An append-only record of a run, written line by line so a run killed halfway
 * leaves everything it had already established for `--resume` to read.
 */
export class Journal {
	private constructor(private readonly path: string) {}

	static at(path: string): Journal {
		const directory = dirname(path)
		if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
		return new Journal(path)
	}

	append(record: JournalRecord): void {
		appendFileSync(this.path, `${JSON.stringify(record)}\n`, 'utf8')
	}

	/** Every record already written, ignoring a final truncated line. */
	read(): readonly JournalRecord[] {
		if (!existsSync(this.path)) return []

		return readFileSync(this.path, 'utf8')
			.split('\n')
			.filter(line => line.trim() !== '')
			.flatMap(line => {
				try {
					return [JSON.parse(line) as JournalRecord]
				} catch {
					// A run killed mid-write leaves a partial last line. Everything before
					// it is intact, so the partial line is dropped rather than the file.
					return []
				}
			})
	}

	/** Checks already observed, so a resumed run does not repeat them. */
	completed(): ReadonlySet<string> {
		return new Set(
			this.read()
				.filter(record => record.kind === 'observation')
				.map(record => record.observation.id),
		)
	}

	/** Observations already recorded, so a resumed run reports the whole thing. */
	observations(): readonly Observation[] {
		return this.read()
			.filter(record => record.kind === 'observation')
			.map(record => record.observation)
	}
}
