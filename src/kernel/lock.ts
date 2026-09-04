import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	unlinkSync,
	writeSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { dirname } from 'node:path'

/**
 * How long a lock may be held before the run holding it is stuck rather than
 * slow. The longest suite here is minutes, so two hours is not a slow run.
 */
export const STUCK_AFTER_MS = 2 * 60 * 60 * 1000

/** Who is running against a target, so a second run can name them rather than guess. */
export interface LockHolder {
	readonly pid: number
	readonly host: string
	readonly runId: string
	readonly since: string
}

export type LockOutcome =
	| {
			readonly held: true
			readonly release: () => void
			/** Set when the previous holder was gone and its lock was taken over. */
			readonly reclaimed?: LockHolder
	  }
	| { readonly held: false; readonly holder: LockHolder; readonly ageMs: number }

export interface LockOptions {
	readonly runId: string
	readonly now?: Date
	readonly pid?: number
	readonly host?: string
	/** Whether a process is still running, injected so the reclaim path can be tested. */
	readonly isAlive?: (pid: number) => boolean
}

/** Stands in for a holder nothing could read, so a message still has fields to print. */
const UNREADABLE: LockHolder = { pid: 0, host: '', runId: 'unreadable', since: '' }

/** Undefined when the file names nobody: a run killed between creating it and writing it. */
const readHolder = (path: string): LockHolder | undefined => {
	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockHolder>
		if (typeof parsed.pid !== 'number' || typeof parsed.host !== 'string') return undefined
		return {
			pid: parsed.pid,
			host: parsed.host,
			runId: parsed.runId ?? 'unknown',
			since: parsed.since ?? '',
		}
	} catch {
		return undefined
	}
}

const stillRunning = (pid: number): boolean => {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

const write = (path: string, holder: LockHolder): void => {
	// Created with wx, which fails when the file exists: the whole point. Reading
	// first and creating after is the race this is here to close.
	const descriptor = openSync(path, 'wx')
	try {
		writeSync(descriptor, `${JSON.stringify(holder, null, '\t')}\n`)
	} finally {
		closeSync(descriptor)
	}
}

/**
 * Takes the lock for one target, or reports who holds it. A holder that is no
 * longer running on this host is taken over; one on another host never is,
 * because nothing here can tell whether that process is alive.
 */
export const acquireLock = (path: string, options: LockOptions): LockOutcome => {
	const now = options.now ?? new Date()
	const host = options.host ?? hostname()
	const isAlive = options.isAlive ?? stillRunning
	const mine: LockHolder = {
		pid: options.pid ?? process.pid,
		host,
		runId: options.runId,
		since: now.toISOString(),
	}

	mkdirSync(dirname(path), { recursive: true })

	const take = (allowReclaim: boolean): LockOutcome => {
		try {
			write(path, mine)
			return { held: true, release: () => releaseLock(path, mine) }
		} catch {
			const holder = readHolder(path)
			// A lock naming nobody blocks everybody for ever, which is the failure this
			// whole mechanism would otherwise become.
			const gone = holder === undefined || (holder.host === host && !isAlive(holder.pid))

			if (allowReclaim && gone) {
				unlinkSync(path)
				const retried = take(false)
				return retried.held ? { ...retried, reclaimed: holder } : retried
			}

			return {
				held: false,
				holder: holder ?? UNREADABLE,
				ageMs:
					holder === undefined || holder.since === ''
						? 0
						: now.getTime() - new Date(holder.since).getTime(),
			}
		}
	}

	return take(true)
}

/** Releases the lock only when it is still ours, so a reclaimed one is never deleted twice. */
export const releaseLock = (path: string, mine: LockHolder): void => {
	if (!existsSync(path)) return
	const holder = readHolder(path)
	if (holder === undefined || holder.pid !== mine.pid || holder.runId !== mine.runId) return
	unlinkSync(path)
}
