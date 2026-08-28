import { TransportFailure } from '../kernel/failure.js'

export interface HttpRequest {
	readonly method: string
	readonly path: string
	readonly headers?: Readonly<Record<string, string>>
	readonly body?: string
	readonly timeoutMs?: number
}

export interface HttpResponse {
	readonly status: number
	readonly headers: Readonly<Record<string, string>>
	readonly body: string
	/** Every `set-cookie` separately, because collapsing them into an object loses all but one. */
	readonly setCookie: readonly string[]
	/** Wall time for the round trip, which is what a latency check measures. */
	readonly durationMs: number
}

/**
 * An HTTP surface that reports a dead socket as a transport failure, since Node
 * reports a refused connection as a bare `TypeError` the kernel would never retry.
 */
export class HttpSurface {
	constructor(
		private readonly baseUrl: string,
		private readonly defaultTimeoutMs = 10_000,
	) {}

	get origin(): string {
		return this.baseUrl
	}

	async send(request: HttpRequest): Promise<HttpResponse> {
		const url = `${this.baseUrl}${request.path}`
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? this.defaultTimeoutMs)
		const started = performance.now()

		try {
			const response = await fetch(url, {
				method: request.method,
				...(request.headers ? { headers: request.headers } : {}),
				...(request.body === undefined ? {} : { body: request.body }),
				signal: controller.signal,
				redirect: 'manual',
			})

			return {
				status: response.status,
				headers: Object.fromEntries(response.headers.entries()),
				body: await response.text(),
				setCookie: response.headers.getSetCookie(),
				durationMs: Math.round(performance.now() - started),
			}
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause)
			throw new TransportFailure(`${request.method} ${url}: ${detail}`)
		} finally {
			clearTimeout(timeout)
		}
	}

	get(path: string, headers?: Record<string, string>): Promise<HttpResponse> {
		return this.send({ method: 'GET', path, ...(headers ? { headers } : {}) })
	}
}
