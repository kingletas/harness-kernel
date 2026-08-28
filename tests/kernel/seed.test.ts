import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deriveRng, intBetween, pick, shuffle } from '../../src/kernel/seed.js'

const take = (count: number, rng: () => number): number[] =>
	Array.from({ length: count }, () => rng())

describe('deriveRng', () => {
	it('gives the same stream for the same seed and label', () => {
		assert.deepEqual(take(5, deriveRng('abc', 'check.one')), take(5, deriveRng('abc', 'check.one')))
	})

	it('gives different streams to different labels', () => {
		assert.notDeepEqual(
			take(5, deriveRng('abc', 'check.one')),
			take(5, deriveRng('abc', 'check.two')),
		)
	})

	it('gives a check the same values however many checks ran before it', () => {
		// The property that makes a run reproducible after the suite is filtered or
		// reordered: a check draws from its own stream, not from a shared one.
		const alone = take(3, deriveRng('seed-1', 'check.late'))

		const shared = deriveRng('seed-1', 'check.early')
		take(50, shared)
		const afterOthers = take(3, deriveRng('seed-1', 'check.late'))

		assert.deepEqual(afterOthers, alone)
	})

	it('produces values inside the unit interval', () => {
		for (const value of take(200, deriveRng('seed', 'label'))) {
			assert.ok(value >= 0 && value < 1, `${value} is outside [0, 1)`)
		}
	})
})

describe('helpers', () => {
	it('keeps intBetween inside its bounds', () => {
		const rng = deriveRng('seed', 'ints')
		for (let index = 0; index < 200; index++) {
			const value = intBetween(rng, 3, 7)
			assert.ok(value >= 3 && value <= 7, `${value} is outside [3, 7]`)
		}
	})

	it('shuffles without losing or duplicating an element', () => {
		const items = [1, 2, 3, 4, 5, 6, 7, 8]
		const shuffled = shuffle(deriveRng('seed', 'shuffle'), items)
		assert.deepEqual(
			[...shuffled].sort((a, b) => a - b),
			items,
		)
	})

	it('refuses to pick from an empty list', () => {
		assert.throws(() => pick(deriveRng('seed', 'pick'), []), /empty/)
	})
})
