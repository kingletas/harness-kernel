import { join } from 'node:path'

/**
 * Where one harness keeps what it writes. Each tool owns its own, because a
 * shared directory would put two tools' ledgers in one namespace.
 */
export interface Workspace {
	readonly root: string
	/** Committed: what a target refuses, does not support, or is held out of the verdict. */
	readonly ledger: string
	/** Per environment: the signature, and the measurement history that is not committed. */
	readonly baselines: string
	/** Per run, and never committed: the journal, the report and the sign-off sheet. */
	readonly results: string
}

/**
 * A workspace rooted at a directory the caller resolved, never one counted from
 * here — depth is a property of where a file sits, so a module that counts its
 * own is repointed silently by moving it.
 */
export const workspaceAt = (root: string): Workspace => ({
	root,
	ledger: join(root, 'ledger'),
	baselines: join(root, 'baselines'),
	results: join(root, 'results'),
})
