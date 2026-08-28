import type { Registry } from '../targets/registry.js'
import type { Workspace } from '../paths.js'

/**
 * One tool built on this kernel: what it is called, which targets it knows and
 * where it keeps what it writes. Passed to every command rather than reached
 * through a module, so two harnesses can never share a ledger by accident.
 */
export interface Harness {
	/** The command's own name, as a person typed it. */
	readonly name: string
	readonly registry: Registry
	readonly workspace: Workspace
}
