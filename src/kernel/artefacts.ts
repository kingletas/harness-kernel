import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * A path for the report, always separated by `/`. A report is read on a machine
 * that is not the one that wrote it, so a Windows separator would not survive.
 */
const reportPath = (root: string, absolute: string): string =>
	relative(root, absolute).split(sep).join('/')

/** A file a check produced that helps explain its verdict. */
export interface Artefact {
	/** What it is, named by whoever produced it: `trace`, `video`, `har`. */
	readonly kind: string
	/** Relative to the run's own directory, so a report survives being moved. */
	readonly path: string
	readonly bytes: number
}

/** A check's claim on a file it is about to write. */
interface Claim {
	readonly kind: string
	readonly absolute: string
}

/**
 * Where a check may leave evidence, with a budget the whole run shares because
 * no single check can see the total.
 */
export class ArtefactStore {
	private readonly claims = new Map<string, Claim[]>()
	private spent = 0
	private exhausted = false

	constructor(
		private readonly root: string,
		private readonly budgetBytes = 128 * 1024 * 1024,
	) {}

	/** True while there is budget left; a producer may skip the work entirely. */
	get accepting(): boolean {
		return !this.exhausted
	}

	/** Creates and returns the directory this check may write into. */
	dirFor(checkId: string): string {
		const dir = join(this.root, 'artefacts', checkId)
		mkdirSync(dir, { recursive: true })
		return dir
	}

	/** Declares a file the check has written, or is about to. */
	claim(checkId: string, kind: string, absolute: string): void {
		const held = this.claims.get(checkId) ?? []
		held.push({ kind, absolute })
		this.claims.set(checkId, held)
	}

	/** Drops everything this check produced, for a verdict that needs no explaining. */
	discard(checkId: string): void {
		this.claims.delete(checkId)
		rmSync(join(this.root, 'artefacts', checkId), { recursive: true, force: true })
	}

	/**
	 * Turns this check's claims into artefacts, dropping what was never written
	 * and deleting what the run can no longer afford.
	 */
	collect(checkId: string): { artefacts: readonly Artefact[]; dropped?: string } {
		const held = this.claims.get(checkId) ?? []
		this.claims.delete(checkId)

		const artefacts: Artefact[] = []
		let dropped: string | undefined

		for (const { kind, absolute } of held) {
			if (!existsSync(absolute)) continue
			const bytes = statSync(absolute).size

			if (this.spent + bytes > this.budgetBytes) {
				rmSync(absolute, { force: true })
				this.exhausted = true
				dropped = `evidence stopped after ${Math.round(this.budgetBytes / 1024 / 1024)}MB — this run produced more than it may keep`
				continue
			}

			this.spent += bytes
			artefacts.push({ kind, path: reportPath(this.root, absolute), bytes })
		}

		// A directory that kept nothing is litter, and a tree of them reads as
		// though every check produced evidence.
		if (artefacts.length === 0) this.discard(checkId)

		return dropped === undefined ? { artefacts } : { artefacts, dropped }
	}
}
