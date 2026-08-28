import type { Harness } from '../harness.js'

export const listTargets = (harness: Harness): number => {
	for (const name of harness.registry.names()) {
		const target = harness.registry.named(name)
		process.stdout.write(`${name}\n`)
		for (const [suite, checks] of target.suites()) {
			process.stdout.write(`  ${suite.padEnd(16)} ${checks.length} check(s)\n`)
		}
	}
	return 0
}
