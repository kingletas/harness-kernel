import { isRetryable, type FailureClass } from './failure.js'
import { jittered, type Rng } from './seed.js'

export interface RetryPolicy {
	/** Total attempts allowed for a failure of this class, including the first. */
	attemptsFor(failure: FailureClass): number
	/** How long to wait before the given attempt number. */
	delayMs(failure: FailureClass, attempt: number, rng: Rng): number
}

export interface RetryPolicyOptions {
	readonly transportAttempts?: number
	readonly timeoutAttempts?: number
	readonly baseDelayMs?: number
}

/**
 * Retries transport and timeout failures and nothing else, giving a timeout one
 * further attempt rather than three because hammering a slow target kills it.
 */
export const retryPolicy = (options: RetryPolicyOptions = {}): RetryPolicy => {
	const transportAttempts = options.transportAttempts ?? 3
	const timeoutAttempts = options.timeoutAttempts ?? 2
	const baseDelayMs = options.baseDelayMs ?? 250

	return {
		attemptsFor(failure) {
			if (!isRetryable(failure)) return 1
			return failure === 'transport' ? transportAttempts : timeoutAttempts
		},
		delayMs(failure, attempt, rng) {
			return isRetryable(failure) ? jittered(rng, baseDelayMs, attempt) : 0
		},
	}
}

export const DEFAULT_RETRY_POLICY = retryPolicy()

/** A policy that never retries, for suites where a repeat would be destructive. */
export const NO_RETRY: RetryPolicy = {
	attemptsFor: () => 1,
	delayMs: () => 0,
}
