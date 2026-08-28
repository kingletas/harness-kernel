/** A deterministic source of numbers in [0, 1). */
export type Rng = () => number

/** xmur3 — mixes a string into a 32-bit state, the seed being a string so a person can choose one. */
const hashString = (text: string): number => {
	let state = 1779033703 ^ text.length
	for (let index = 0; index < text.length; index++) {
		state = Math.imul(state ^ text.charCodeAt(index), 3432918353)
		state = (state << 13) | (state >>> 19)
	}
	state = Math.imul(state ^ (state >>> 16), 2246822507)
	state = Math.imul(state ^ (state >>> 13), 3266489909)
	return (state ^= state >>> 16) >>> 0
}

/** mulberry32 — small, fast, and adequate for choosing test data. */
const mulberry32 = (state: number): Rng => {
	let value = state >>> 0
	return () => {
		value = (value + 0x6d2b79f5) >>> 0
		let mixed = Math.imul(value ^ (value >>> 15), 1 | value)
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
	}
}

/**
 * A generator for one named consumer of a run's seed, derived from
 * `(seed, label)` so filtering, reordering or widening a run cannot move it.
 */
export const deriveRng = (seed: string, label: string): Rng =>
	mulberry32(hashString(`${seed}:${label}`))

/** An integer in [min, max]. */
export const intBetween = (rng: Rng, min: number, max: number): number =>
	min + Math.floor(rng() * (max - min + 1))

/** One element of a non-empty list. */
export const pick = <T>(rng: Rng, items: readonly T[]): T => {
	const chosen = items[intBetween(rng, 0, items.length - 1)]
	if (chosen === undefined) throw new Error('cannot pick from an empty list')
	return chosen
}

/** A copy of `items` in a shuffled order. */
export const shuffle = <T>(rng: Rng, items: readonly T[]): T[] => {
	const copy = [...items]
	for (let index = copy.length - 1; index > 0; index--) {
		const swap = intBetween(rng, 0, index)
		const held = copy[index] as T
		copy[index] = copy[swap] as T
		copy[swap] = held
	}
	return copy
}

/** A backoff delay with jitter, drawn from the run's seed so a replay waits the same. */
export const jittered = (rng: Rng, baseMs: number, attempt: number): number => {
	const exponential = baseMs * 2 ** Math.max(0, attempt - 1)
	return Math.round(exponential * (0.5 + rng() * 0.5))
}

/** A seed suitable for a run nobody chose one for. */
export const freshSeed = (): string =>
	Math.floor(Math.random() * 0xffffffff)
		.toString(16)
		.padStart(8, '0')
