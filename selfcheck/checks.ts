import type { CheckDefinition } from '../src/kernel/check.js'
import { AssertionFailure, TransportFailure } from '../src/kernel/failure.js'

/**
 * A fetch that turns a dead socket into the kernel's own transport failure,
 * because Node reports a refused connection as a generic `TypeError`.
 */
const get = async (url: string, headers: Record<string, string> = {}): Promise<Response> => {
	try {
		return await fetch(url, { headers })
	} catch (cause) {
		throw new TransportFailure(`could not reach ${url}: ${(cause as Error).message}`)
	}
}

const expectStatus = (response: Response, expected: number, what: string): void => {
	if (response.status !== expected) {
		throw new AssertionFailure(`${what}: expected ${expected}, got ${response.status}`, {
			expected,
			actual: response.status,
		})
	}
}

/**
 * The checks the harness runs against its own stub, proving both directions:
 * silence from a healthy target, and one line naming each defect.
 */
export const selfcheckChecks = (baseUrl: string): readonly CheckDefinition[] => [
	{
		id: 'selfcheck.health',
		title: 'The target answers liveness and names its build',
		suite: 'selfcheck',
		async body({ record }) {
			const response = await get(`${baseUrl}/health`)
			expectStatus(response, 200, 'liveness')

			const body = (await response.json()) as { build?: string }
			record('build', body.build ?? 'unknown')
		},
	},
	{
		id: 'selfcheck.session-less-read',
		title: 'A read surface refuses a caller with no credentials',
		suite: 'selfcheck',
		async body() {
			const response = await get(`${baseUrl}/v1/overview`)
			expectStatus(response, 401, 'session-less read')
		},
	},
	{
		id: 'selfcheck.authorised-read',
		title: 'A read surface answers a caller that has credentials',
		suite: 'selfcheck',
		async body() {
			const response = await get(`${baseUrl}/v1/overview`, { authorization: 'Bearer stub' })
			expectStatus(response, 200, 'authorised read')
		},
	},
	{
		id: 'selfcheck.intermittent',
		title: 'A route that sometimes fails is reported as flaky, not as passing',
		suite: 'selfcheck',
		async body() {
			const response = await get(`${baseUrl}/v1/intermittent`)
			if (response.status === 503) {
				// A 503 is the target being unreachable for this request rather than a
				// property failing, so it is raised as transport and may be retried.
				throw new TransportFailure('the route answered 503')
			}
			expectStatus(response, 200, 'intermittent route')
		},
	},
	{
		id: 'selfcheck.latency',
		title: 'A route answers, and how long it took is recorded',
		suite: 'selfcheck',
		async body({ measure }) {
			const started = Date.now()
			const response = await get(`${baseUrl}/v1/slow`)
			expectStatus(response, 200, 'slow route')
			measure({ name: 'response', value: Date.now() - started, unit: 'ms', stage: '/v1/slow' })
		},
	},
	{
		id: 'selfcheck.browser-only',
		title: 'A check needing a capability the target lacks is reported, not failed',
		suite: 'selfcheck',
		needs: ['browser'],
		body: () =>
			Promise.reject(
				new AssertionFailure('this body must never run against a target without a browser'),
			),
	},
]
