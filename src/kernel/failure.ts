/**
 * Why a check failed, which decides whether it may be retried: only `transport`
 * and `timeout` ever are, because retrying an assertion hides the defect.
 */
export type FailureClass = 'transport' | 'timeout' | 'assertion' | 'precondition'

/** A property of the target did not hold. Never retried. */
export class AssertionFailure extends Error {
	override readonly name = 'AssertionFailure'

	constructor(
		message: string,
		readonly detail?: { readonly expected?: unknown; readonly actual?: unknown },
	) {
		super(message)
	}
}

/** The check could not be set up — a fixture, a seed, a credential. Never retried. */
export class PreconditionFailure extends Error {
	override readonly name = 'PreconditionFailure'
}

/** The target does not offer what this check needs. Reported, never failed. */
export class UnsupportedCapability extends Error {
	override readonly name = 'UnsupportedCapability'

	constructor(readonly capabilities: readonly string[]) {
		super(`target does not declare: ${capabilities.join(', ')}`)
	}
}

/** The target could not be reached at all. */
export class TransportFailure extends Error {
	override readonly name = 'TransportFailure'
}

const TRANSPORT_CODES = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'ENOTFOUND',
	'EAI_AGAIN',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'EPIPE',
	'EPROTO',
	'CERT_HAS_EXPIRED',
	'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])

const TRANSPORT_PATTERNS = [
	/socket hang up/i,
	/fetch failed/i,
	/net::ERR_/,
	/connection (refused|reset|closed)/i,
	/failed to connect/i,
]

const TIMEOUT_PATTERNS = [/timeout/i, /timed out/i, /aborted/i]

const codeOf = (error: unknown): string | undefined => {
	const code: unknown = (error as { code?: unknown } | null)?.code
	return typeof code === 'string' ? code : undefined
}

const messageOf = (error: unknown): string =>
	error instanceof Error
		? `${error.message}\n${error.cause instanceof Error ? error.cause.message : ''}`
		: String(error)

/**
 * Duck-typed detection of an assertion library's failure, matching on shape so
 * the kernel imports no assertion library.
 */
const looksLikeAssertion = (error: unknown): boolean => {
	if (error === null || typeof error !== 'object') return false
	const candidate = error as Record<string, unknown>
	return (
		'matcherResult' in candidate ||
		('expected' in candidate && 'actual' in candidate) ||
		candidate['name'] === 'AssertionError'
	)
}

/**
 * Classifies an error so the retry policy can decide, asking the structured
 * check first; anything unexplained is an `assertion` and so is never retried.
 */
export const classify = (error: unknown): FailureClass => {
	if (error instanceof AssertionFailure) return 'assertion'
	if (error instanceof PreconditionFailure) return 'precondition'
	if (error instanceof TransportFailure) return 'transport'
	if (looksLikeAssertion(error)) return 'assertion'

	const code = codeOf(error)
	if (code !== undefined) {
		if (TRANSPORT_CODES.has(code)) return 'transport'
		if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout'
	}

	const message = messageOf(error)
	if (TRANSPORT_PATTERNS.some(pattern => pattern.test(message))) return 'transport'
	if (TIMEOUT_PATTERNS.some(pattern => pattern.test(message))) return 'timeout'

	return 'assertion'
}

/** Whether a failure of this class may be attempted again. */
export const isRetryable = (failure: FailureClass): boolean =>
	failure === 'transport' || failure === 'timeout'

/** A one-line description of an error, safe to put in a report. */
export const describe = (error: unknown): string => {
	if (error instanceof Error) {
		const code = codeOf(error)
		return code === undefined ? error.message : `${error.message} (${code})`
	}
	return String(error)
}
