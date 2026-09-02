import type { Options } from '../options.js'
import { selectionFor } from './run.js'
import type { Harness } from '../harness.js'

export const planOnly = async (harness: Harness, options: Options): Promise<number> => {
	if (options.target === undefined) {
		process.stderr.write(
			`${harness.name}: plan needs --target. Known: ${harness.registry.names().join(', ')}\n`,
		)
		return 2
	}

	const target = harness.registry.named(options.target)
	const selection = await selectionFor(harness, target, { ...options, changed: true })
	if (selection === undefined) return 2

	const checks = [...target.suites().values()].flat()
	const chosen = selection.runEverything
		? checks
		: checks.filter(check => check.area !== undefined && selection.areas.includes(check.area))

	process.stdout.write(`\n  ${selection.reason}\n`)
	if (selection.areas.length > 0) {
		process.stdout.write(`  at risk: ${selection.areas.join(', ')}\n`)
	}
	for (const path of selection.unmapped) process.stdout.write(`  unmapped: ${path}\n`)
	process.stdout.write(
		`\n  would run ${chosen.length} of ${checks.length} checks` +
			// The reason is printed above; naming a second one here asserted the
			// map was incomplete even when the missing piece was the checkout.
			`${selection.runEverything ? ' — everything' : ''}\n\n`,
	)

	return 0
}
