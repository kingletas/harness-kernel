import type { Capabilities } from '../kernel/capabilities.js'
import type { CheckDefinition } from '../kernel/check.js'
import type { Area } from '../kernel/areas.js'
import type { ImpactRule } from '../kernel/selection.js'
import type { DriftRecorder } from '../history/drift.js'
import type { PreflightResult } from '../kernel/preflight.js'
import type { ProbeReport } from '../kernel/probe.js'

/**
 * The only thing in the harness allowed to know a particular target exists,
 * answering what can be asked of it, whether it is up, and which checks apply.
 */
export interface Target {
	readonly name: string
	readonly environment: string
	readonly capabilities: Capabilities
	preflight(): Promise<PreflightResult>
	suites(): ReadonlyMap<string, readonly CheckDefinition[]>
	/** The sign-off sheet this target reports into. */
	areas(): readonly Area[]
	/** Where the target's own source lives, for reading a diff. */
	readonly repoDir?: string
	/** What a change to a path in that repository puts at risk. */
	impact?(): readonly ImpactRule[]
	/** Reports whether this suite could drive the target, asserting nothing and writing nothing. */
	probe?(): Promise<ProbeReport>
	/** Releases anything the target opened. A browser is the reason this exists. */
	dispose?(): Promise<void>
}

/** Everything a target's factory needs from the caller. */
export interface TargetOptions {
	readonly baseUrl?: string
	readonly environment?: string
	/** Collects which selector candidate answered, for targets that resolve any. */
	readonly recorder?: DriftRecorder
	/** A store baseline supplied directly rather than read from disk, for a fixture store. */
	readonly store?: unknown
}
