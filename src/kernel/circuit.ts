import type { FailureClass } from './failure.js'

/** How many checks had reached the target when an attempt began. */
export interface CircuitToken {
	readonly contacts: number
}

/**
 * Stops a run once enough checks have failed to reach the target with none
 * reaching it in between, so a dead target costs one fact rather than one per
 * check. @see README, "A dead target is one fact".
 */
export class CircuitBreaker {
	/** Monotone across the run: how many checks have reached the target. */
	private contacts = 0
	/** Transport failures recorded since the last contact. */
	private sinceContact = 0
	private openedBecause: string | undefined

	constructor(private readonly threshold = 3) {
		if (threshold < 1) throw new Error('a circuit breaker threshold must be at least 1')
	}

	get isOpen(): boolean {
		return this.openedBecause !== undefined
	}

	/** Why the circuit opened, for the single `blocked` observation the run emits. */
	get reason(): string | undefined {
		return this.openedBecause
	}

	/** Taken before an attempt, and handed back with whatever that attempt did. */
	begin(): CircuitToken {
		return { contacts: this.contacts }
	}

	/** A check reached the target. */
	recordReachable(): void {
		this.contacts += 1
		this.sinceContact = 0
	}

	/** A check that began at `token` ended in a failure of the given class. */
	recordFailure(failure: FailureClass, detail: string, token: CircuitToken): void {
		if (failure === 'precondition') return
		if (failure !== 'transport') {
			this.recordReachable()
			return
		}

		// Something reached the target while this check was trying, so the failure
		// is evidence about the check rather than about the target.
		if (token.contacts !== this.contacts) return

		this.sinceContact += 1
		if (this.sinceContact >= this.threshold && this.openedBecause === undefined) {
			this.openedBecause =
				`${this.sinceContact} checks could not reach the target, ` +
				`with none reaching it in between — ${detail}`
		}
	}
}
