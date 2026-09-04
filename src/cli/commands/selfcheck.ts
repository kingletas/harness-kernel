import { startStub } from '../../../fixtures/stub-target.js'
import { selfcheckChecks } from '../../../selfcheck/checks.js'
import { NO_CAPABILITIES } from '../../kernel/capabilities.js'
import { startRun, withBuild } from '../../kernel/run.js'
import type { Options } from '../options.js'
import { execute } from '../pipeline.js'
import type { Harness } from '../harness.js'

export const selfcheck = async (harness: Harness, options: Options): Promise<number> => {
	const stub = await startStub(options.defect)

	try {
		const run = withBuild(
			startRun({
				target: 'stub',
				environment: 'local',
				suites: ['selfcheck'],
				...(options.seed === undefined ? {} : { seed: options.seed }),
			}),
			stub.build,
		)

		// Never notifies, whatever the environment asks for. The stub is told what
		// to be, so every defect it carries is one this command chose to inject.
		return await execute(harness, run, selfcheckChecks(stub.url), NO_CAPABILITIES, {
			...options,
			notify: options.notify === 'on' ? 'on' : 'off',
		})
	} finally {
		await stub.close()
	}
}
