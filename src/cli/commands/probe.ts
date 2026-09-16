import { describe } from '../../kernel/failure.js'
import { renderProbe } from '../../kernel/probe.js'
import type { Options } from '../options.js'
import type { Harness } from '../harness.js'

/**
 * Reports what the suite can find on a site and judges nothing, exiting 0 even
 * when nothing resolves; it exits 1 only when the probe itself could not run.
 */
export const probeTarget = async (harness: Harness, options: Options): Promise<number> => {
	if (options.target === undefined) {
		process.stderr.write(
			`${harness.name}: probe needs --target. Known: ${harness.registry.names().join(', ')}\n`,
		)
		return 2
	}

	const target = harness.registry.named(options.target, {
		...(options.url ? { baseUrl: options.url } : {}),
	})
	if (target.probe === undefined) {
		process.stderr.write(
			`${harness.name}: ${target.name} has nothing to probe — it drives no browser\n`,
		)
		return 2
	}

	try {
		renderProbe(await target.probe(), line => process.stdout.write(`${line}\n`))
		return 0
	} catch (error) {
		process.stderr.write(`${harness.name}: could not probe ${target.name} — ${describe(error)}\n`)
		return 1
	} finally {
		await target.dispose?.()
	}
}
