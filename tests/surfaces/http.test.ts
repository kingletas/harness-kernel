import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it } from 'node:test'
import { TransportFailure } from '../../src/kernel/failure.js'
import { HttpSurface } from '../../src/surfaces/http.js'

const listen = (server: Server): Promise<string> =>
	new Promise(resolve => {
		server.listen(0, '127.0.0.1', () => {
			resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
		})
	})

const close = (server: Server): Promise<void> =>
	new Promise(resolve => {
		server.closeAllConnections()
		server.close(() => resolve())
	})

/** An address nothing listens on, taken from a server that has just stopped. */
const refusedUrl = async (): Promise<string> => {
	const server = createServer()
	const url = await listen(server)
	await close(server)
	return url
}

const failureOf = async (surface: HttpSurface, path: string): Promise<TransportFailure> => {
	try {
		await surface.get(path)
	} catch (error) {
		assert.ok(
			error instanceof TransportFailure,
			`expected a TransportFailure, got ${String(error)}`,
		)
		return error
	}
	assert.fail('the request succeeded')
}

describe('HttpSurface transport failures', () => {
	it('names the reason Node keeps in the cause, not only "fetch failed"', async () => {
		const url = await refusedUrl()

		const failure = await failureOf(new HttpSurface(url), '/magento_version')

		assert.match(
			failure.message,
			/^GET http:\/\/127\.0\.0\.1:\d+\/magento_version: fetch failed \(ECONNREFUSED: /,
		)
		assert.ok(failure.cause instanceof TypeError)
	})

	it('adds nothing when the error has no cause to report', async () => {
		const server = createServer(() => undefined)
		const url = await listen(server)
		try {
			const failure = await failureOf(new HttpSurface(url, 50), '/slow')

			assert.equal(failure.message, `GET ${url}/slow: This operation was aborted`)
		} finally {
			await close(server)
		}
	})

	it('names only the code when the cause has no message', async () => {
		const realFetch = globalThis.fetch
		globalThis.fetch = () =>
			Promise.reject(
				new TypeError('fetch failed', {
					cause: Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' }),
				}),
			)
		try {
			const failure = await failureOf(new HttpSurface('http://localhost:1'), '/')

			assert.equal(failure.message, 'GET http://localhost:1/: fetch failed (ECONNREFUSED)')
		} finally {
			globalThis.fetch = realFetch
		}
	})

	it('still answers normally when the request succeeds', async () => {
		const server = createServer((_request, response) => response.end('ok'))
		const url = await listen(server)
		try {
			const response = await new HttpSurface(url).get('/')

			assert.equal(response.status, 200)
			assert.equal(response.body, 'ok')
		} finally {
			await close(server)
		}
	})
})
