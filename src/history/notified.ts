import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Consecutive runs a green story must hold before a recovery is worth sending. */
export const HOLD_RUNS = 2

/** The most stories kept, so an alternating pair cannot crowd the file. */
const REMEMBERED = 8

/** How many stories the channel has been told, and how long ago. */
export interface StoryRecord {
	/** The state signature, which is what makes two runs the same story. */
	readonly story: string
	readonly sends: number
	/** Runs seen since this story was last delivered. */
	readonly runsSince: number
	readonly firstSentAt: string
	readonly lastSentAt: string
}

/** What the person on the other end of the channel currently believes. */
export interface NotifyState {
	/** The story last delivered, whatever it was. */
	readonly told: string
	/** A green story waiting to hold before it counts as a recovery. */
	readonly settling: string
	readonly settledRuns: number
	readonly stories: readonly StoryRecord[]
}

export const NO_NOTIFICATIONS: NotifyState = {
	told: '',
	settling: '',
	settledRuns: 0,
	stories: [],
}

export type NotifyDecision =
	| { readonly send: false; readonly why: string; readonly next: NotifyState }
	| {
			readonly send: true
			readonly kind: 'new' | 'again' | 'recovered'
			readonly sends: number
			readonly runsSince: number
			readonly since: string
			readonly next: NotifyState
	  }

/**
 * Runs between one telling of a story and the next, doubling and then holding,
 * so a failure lasting a month is still said once a month rather than never.
 */
export const waitFor = (sends: number): number => Math.min(2 ** Math.max(sends, 1), 32)

const aged = (stories: readonly StoryRecord[]): StoryRecord[] =>
	stories.map(record => ({ ...record, runsSince: record.runsSince + 1 }))

const bump = (
	stories: readonly StoryRecord[],
	story: string,
	at: string,
	previous: StoryRecord | undefined,
): StoryRecord[] =>
	[
		{
			story,
			sends: (previous?.sends ?? 0) + 1,
			runsSince: 0,
			firstSentAt: previous?.firstSentAt ?? at,
			lastSentAt: at,
		},
		...stories.filter(record => record.story !== story),
	].slice(0, REMEMBERED)

/**
 * Whether this run is worth telling somebody about, given what the channel has
 * already carried. The backoff is held per story rather than per channel, so a
 * run alternating between two failures resets neither one's schedule.
 */
export const decideNotification = (
	state: NotifyState,
	summary: { readonly signature: string; readonly red: boolean },
	now: Date = new Date(),
): NotifyDecision => {
	const story = summary.signature
	const at = now.toISOString()
	const stories = aged(state.stories)
	const previous = stories.find(record => record.story === story)

	if (!summary.red) {
		// The silence contract, and the only branch that can be reached every run
		// forever: nothing is wrong and nothing has changed since the last word.
		if (story === state.told) {
			return {
				send: false,
				why: 'the story is unchanged and nothing is red',
				next: { ...state, settling: '', settledRuns: 0, stories },
			}
		}

		// Counted only across consecutive green runs: every red branch below puts it
		// back to zero, so a check breaking every other run never accumulates a hold.
		const settledRuns =
			state.settledRuns > 0 && state.settling === story ? state.settledRuns + 1 : 1
		if (settledRuns < HOLD_RUNS) {
			return {
				send: false,
				why: `green, and holding — ${settledRuns} of ${HOLD_RUNS} runs before a recovery counts`,
				next: { ...state, settling: story, settledRuns, stories },
			}
		}

		return {
			send: true,
			kind: 'recovered',
			sends: (previous?.sends ?? 0) + 1,
			runsSince: previous?.runsSince ?? 0,
			since: previous?.firstSentAt ?? at,
			next: {
				told: story,
				settling: '',
				settledRuns: 0,
				stories: bump(stories, story, at, previous),
			},
		}
	}

	// A story nobody has been told is news whatever else has happened. One that
	// has been told waits out its own schedule, whether or not it was the last.
	if (previous !== undefined && previous.runsSince < waitFor(previous.sends)) {
		return {
			send: false,
			why:
				`already sent ${previous.sends} time(s), ${previous.runsSince} run(s) ago — ` +
				`the next repeat is ${waitFor(previous.sends) - previous.runsSince} run(s) away`,
			next: { ...state, settling: '', settledRuns: 0, stories },
		}
	}

	return {
		send: true,
		kind: previous === undefined || story !== state.told ? 'new' : 'again',
		sends: (previous?.sends ?? 0) + 1,
		runsSince: previous?.runsSince ?? 0,
		since: previous?.firstSentAt ?? at,
		next: {
			told: story,
			settling: '',
			settledRuns: 0,
			stories: bump(stories, story, at, previous),
		},
	}
}

export const loadNotifyState = (path: string): NotifyState => {
	if (!existsSync(path)) return NO_NOTIFICATIONS
	const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<NotifyState>
	return {
		told: parsed.told ?? '',
		settling: parsed.settling ?? '',
		settledRuns: parsed.settledRuns ?? 0,
		stories: parsed.stories ?? [],
	}
}

export const saveNotifyState = (path: string, state: NotifyState): void => {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(state, null, '\t')}\n`, 'utf8')
}
