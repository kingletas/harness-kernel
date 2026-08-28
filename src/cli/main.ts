import { join } from 'node:path'
import { registryOf } from '../targets/registry.js'
import { workspaceAt } from '../paths.js'
import { runCli } from './dispatch.js'
import type { Harness } from './harness.js'

/**
 * The kernel proving itself, in its own workspace. It knows no targets — the
 * stub is not one — so the only command with anything to do here is `selfcheck`,
 * and the history it keeps is the kernel's rather than a tool's.
 */
const harness: Harness = {
	name: 'harness-selfcheck',
	registry: registryOf({}),
	workspace: workspaceAt(join(import.meta.dirname, '..', '..', '..')),
}

process.exitCode = await runCli(harness, process.argv.slice(2))
