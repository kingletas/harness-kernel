import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
	decideNotification,
	loadNotifyState,
	saveNotifyState,
	waitFor,
	HOLD_RUNS,
	NO_NOTIFICATIONS,
	type NotifyState,
} from '../../src/history/notified.js'

const GREEN = { signature: '', red: false }
const A = { signature: 'a.check:fail', red: true }
const B = { signature: 'b.check:fail', red: true }

/** Feeds runs through the decision in order, returning what each one decided. */
const runs = (
	sequence: readonly { readonly signature: string; readonly red: boolean }[],
	from: NotifyState = NO_NOTIFICATIONS,
): { sent: boolean[]; state: NotifyState } => {
	let state = from
	const sent: boolean[] = []

	for (const summary of sequence) {
		const decision = decideNotification(state, summary)
		sent.push(decision.send)
		state = decision.next
	}

	return { sent, state }
}

describe('deciding whether anybody is told', () => {
	it('says nothing about a green run whose story has not changed', () => {
		const { sent } = runs([GREEN, GREEN, GREEN])
		assert.deepEqual(sent, [false, false, false])
	})

	it('tells somebody about a failure nobody has heard about', () => {
		const decision = decideNotification(NO_NOTIFICATIONS, A)
		assert.equal(decision.send, true)
		assert.equal(decision.send && decision.kind, 'new')
	})

	it('does not repeat the same failure every run', () => {
		// A true alert repeated sixty times is noise by the fifth, and the channel
		// it trains a person to ignore is the one the next real failure arrives on.
		const { sent } = runs([A, A, A])
		assert.deepEqual(sent, [true, false, true])
	})

	it('does repeat it eventually, because it is still broken', () => {
		// The counter-direction, and the half that gives the one above content: a
		// backoff with no ceiling is an alarm that turns itself off.
		const { sent } = runs([A, A, A, A, A, A, A, A])
		assert.deepEqual(sent, [true, false, true, false, false, false, true, false])
	})

	it('holds a doubling schedule that never grows past its cap', () => {
		assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(waitFor), [2, 4, 8, 16, 32, 32, 32])
	})

	it('waits for a recovery to hold before announcing it', () => {
		const { sent } = runs([A, GREEN, GREEN])
		assert.deepEqual(sent, [true, false, true])
	})

	it('never announces a recovery that keeps breaking again', () => {
		// Recovery has to hold before it counts, or a check flapping every run
		// reports itself fixed every other one.
		let state = NO_NOTIFICATIONS
		const kinds: string[] = []

		for (const summary of [A, GREEN, A, GREEN, A, GREEN]) {
			const decision = decideNotification(state, summary)
			if (decision.send) kinds.push(decision.kind)
			state = decision.next
		}

		assert.ok(
			!kinds.includes('recovered'),
			`a flapping check reported itself fixed: ${kinds.join()}`,
		)
	})

	it('keeps each failure on its own schedule when two of them alternate', () => {
		// The defect this is written against: a backoff held per channel is reset
		// by every change of story, so an alternating pair never backs off at all.
		const { sent } = runs([A, B, A, B, A, B])
		assert.ok(
			sent.filter(Boolean).length < 6,
			'two failures taking turns reset each other and told somebody every run',
		)
	})

	it('says why it stayed quiet, in words that name the schedule', () => {
		const first = decideNotification(NO_NOTIFICATIONS, A)
		const second = decideNotification(first.next, A)
		assert.equal(second.send, false)
		assert.match(!second.send ? second.why : '', /already sent 1 time\(s\), 1 run\(s\) ago/)
	})

	it('counts a run it stayed quiet about, so the schedule advances', () => {
		const { state } = runs([A, A])
		assert.equal(state.stories.find(record => record.story === A.signature)?.runsSince, 1)
	})

	it('remembers at most a handful of stories', () => {
		const many = Array.from({ length: 20 }, (_, index) => ({
			signature: `check-${index}:fail`,
			red: true,
		}))
		assert.ok(runs(many).state.stories.length <= 8)
	})

	it('survives a round trip through a file', () => {
		const path = join(mkdtempSync(join(tmpdir(), 'notify-')), 'state.json')
		const { state } = runs([A, A])
		saveNotifyState(path, state)

		assert.deepEqual(loadNotifyState(path), state)
	})

	it('starts from nothing when no file has been written', () => {
		assert.deepEqual(loadNotifyState(join(tmpdir(), 'no-such-notify-state.json')), NO_NOTIFICATIONS)
	})

	it('needs more than one green run before a recovery counts', () => {
		assert.ok(HOLD_RUNS > 1)
	})
})
