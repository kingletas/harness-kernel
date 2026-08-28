import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** A defect the stub can be told to have, each modelled on one this estate has found. */
export type Defect = 'none' | 'session-less-read' | 'intermittent' | 'slow' | 'refuses-connections'

export interface StubTarget {
	readonly url: string
	readonly build: string
	/** How many times each path has been asked, for checks about retry behaviour. */
	readonly hits: ReadonlyMap<string, number>
	close(): Promise<void>
}

const BUILD = 'stub-1'

/**
 * A target that exists only in this process, bound to port 0 so two selfchecks
 * can run at once without agreeing a port.
 */
export const startStub = async (defect: Defect = 'none'): Promise<StubTarget> => {
	const hits = new Map<string, number>()

	const handler = (request: IncomingMessage, response: ServerResponse): void => {
		const path = (request.url ?? '/').split('?')[0] ?? '/'
		const seen = (hits.get(path) ?? 0) + 1
		hits.set(path, seen)

		const send = (status: number, body: unknown, delayMs = 0): void => {
			const write = (): void => {
				response.writeHead(status, { 'content-type': 'application/json' })
				response.end(JSON.stringify(body))
			}
			if (delayMs > 0) setTimeout(write, delayMs)
			else write()
		}

		const authorised = typeof request.headers.authorization === 'string'

		switch (path) {
			case '/health':
				return send(200, { status: 'ok', build: BUILD })

			case '/v1/overview':
				// The defect: a read surface that answers a caller with no credentials.
				if (!authorised && defect !== 'session-less-read')
					return send(401, { error: 'unauthorised' })
				return send(200, { sessions: 120, orders: 8 })

			case '/v1/intermittent':
				// Fails once, then works — the shape a retry must report as flaky
				// rather than as a pass.
				if (defect === 'intermittent' && seen === 1) return send(503, { error: 'not ready' })
				return send(200, { ok: true })

			case '/v1/slow':
				return send(200, { ok: true }, defect === 'slow' ? 250 : 5)

			default:
				return send(404, { error: 'no such route' })
		}
	}

	if (defect === 'refuses-connections') {
		// A port nothing is listening on. Reserved and released so the number is
		// real and free, which is what makes the connection refused rather than
		// merely slow.
		const scout: Server = createServer()
		await new Promise<void>(resolve => scout.listen(0, '127.0.0.1', resolve))
		const port = (scout.address() as AddressInfo).port
		await new Promise<void>(resolve => scout.close(() => resolve()))

		return {
			url: `http://127.0.0.1:${port}`,
			build: 'unknown',
			hits,
			close: () => Promise.resolve(),
		}
	}

	const server = createServer(handler)
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address() as AddressInfo

	return {
		url: `http://127.0.0.1:${port}`,
		build: BUILD,
		hits,
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close(error => (error ? reject(error) : resolve())),
			),
	}
}
