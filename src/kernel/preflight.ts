import type { Capabilities } from './capabilities.js'

export interface PreflightResult {
	readonly reachable: boolean
	/** What the target is running. `unknown` when the target does not say. */
	readonly build: string
	readonly capabilities: Capabilities
	/** Why the target is not usable, when it is not. */
	readonly problem?: string
}

/** A target answers this before any check runs against it. */
export interface Preflight {
	(): Promise<PreflightResult>
}

/**
 * Whether a suite that writes may run against this target, refused in the
 * kernel because a guard every suite must remember is one that gets forgotten.
 */
export const refusesDestructiveWork = (capabilities: Capabilities): boolean =>
	!capabilities.isDisposable
