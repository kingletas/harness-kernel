import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { probeTarget } from '../../src/cli/commands/probe.js'
import type { Harness } from '../../src/cli/harness.js'
import type { Options } from '../../src/cli/options.js'
import { PreconditionFailure } from '../../src/kernel/failure.js'
import type { ProbeReport } from '../../src/kernel/probe.js'
import { workspaceAt } from '../../src/paths.js'
import { registryOf } from '../../src/targets/registry.js'
import type { Target } from '../../src/targets/target.js'

const REPORT: ProbeReport = {
	target: 'stub',
	baseUrl: 'https://store.test',
	findings: [
		{
			stage: 'home',
			entry: 'searchInput',
			resolved: true,
			via: '#search',
			index: 0,
			of: 2,
			matches: 1,
		},
	],
	unreached: [],
}

const harnessProbing = (
	probe: () => Promise<ProbeReport>,
	disposed: { count: number },
): Harness => ({
	name: 'tool',
	workspace: workspaceAt('/nonexistent'),
	registry: registryOf({
		stub: () =>
			({
				name: 'stub',
				environment: 'test',
				probe,
				dispose: async () => {
					disposed.count += 1
				},
			}) as unknown as Target,
	}),
})

describe('probeTarget', () => {
	let out = ''
	let err = ''
	const realOut = process.stdout.write.bind(process.stdout)
	const realErr = process.stderr.write.bind(process.stderr)

	beforeEach(() => {
		out = ''
		err = ''
		process.stdout.write = (chunk: string) => {
			out += chunk
			return true
		}
		process.stderr.write = (chunk: string) => {
			err += chunk
			return true
		}
	})

	afterEach(() => {
		process.stdout.write = realOut
		process.stderr.write = realErr
	})

	const options = { target: 'stub' } as Options

	it('reports what it found and exits 0', async () => {
		const disposed = { count: 0 }

		const status = await probeTarget(
			harnessProbing(async () => REPORT, disposed),
			options,
		)

		assert.equal(status, 0)
		assert.match(out, /searchInput/)
		assert.equal(err, '')
		assert.equal(disposed.count, 1)
	})

	it('names why the probe could not run, exits 1 and still releases the target', async () => {
		const disposed = { count: 0 }
		const probe = async (): Promise<ProbeReport> => {
			throw new PreconditionFailure(
				'Chromium cannot start because this machine is missing a system library',
			)
		}

		const status = await probeTarget(harnessProbing(probe, disposed), options)

		assert.equal(status, 1)
		assert.equal(
			err,
			'tool: could not probe stub — Chromium cannot start because this machine is missing a system library\n',
		)
		assert.equal(out, '')
		assert.equal(disposed.count, 1)
	})
})
