import { readFileSync, writeFileSync, existsSync } from 'node:fs'

/** A check held out of the run's verdict because it fails intermittently. */
export interface QuarantineEntry {
	readonly id: string
	/** Why it was quarantined, in words a person can act on. */
	readonly reason: string
	readonly since: string
	/** ISO date after which the entry stops applying. */
	readonly until: string
	/** Observed failure rate at the time of quarantine, 0..1. */
	readonly flakeRate: number
}

export interface QuarantineFile {
	readonly entries: readonly QuarantineEntry[]
}

/**
 * The quarantine list, which every entry eventually leaves: `until` is
 * mandatory, because a list nothing expires from is a graveyard.
 */
export class Quarantine {
	private constructor(private readonly entries: ReadonlyMap<string, QuarantineEntry>) {}

	static empty(): Quarantine {
		return new Quarantine(new Map())
	}

	static from(entries: readonly QuarantineEntry[]): Quarantine {
		return new Quarantine(new Map(entries.map(entry => [entry.id, entry])))
	}

	static load(path: string): Quarantine {
		if (!existsSync(path)) return Quarantine.empty()
		const parsed = JSON.parse(readFileSync(path, 'utf8')) as QuarantineFile
		return Quarantine.from(parsed.entries ?? [])
	}

	save(path: string): void {
		const file: QuarantineFile = { entries: [...this.entries.values()] }
		writeFileSync(path, `${JSON.stringify(file, null, '\t')}\n`, 'utf8')
	}

	/** The live entry for a check, or undefined when it is not quarantined now. */
	entryFor(id: string, now: Date = new Date()): QuarantineEntry | undefined {
		const entry = this.entries.get(id)
		if (entry === undefined) return undefined
		return new Date(entry.until).getTime() > now.getTime() ? entry : undefined
	}

	/**
	 * The same list with one more entry, added by a person rather than by the
	 * harness — a harness that stops failing on its own is an alarm turning itself off.
	 */
	with(entry: QuarantineEntry): Quarantine {
		const next = new Map(this.entries)
		next.set(entry.id, entry)
		return new Quarantine(next)
	}

	/** Every entry, live or expired, for a report to render. */
	all(): readonly QuarantineEntry[] {
		return [...this.entries.values()]
	}

	/** Entries whose window has closed, so the report can say they are back. */
	expired(now: Date = new Date()): readonly QuarantineEntry[] {
		return [...this.entries.values()].filter(
			entry => new Date(entry.until).getTime() <= now.getTime(),
		)
	}
}
