/** A webhook that refused the message, or a host that never took it. */
export class WebhookFailure extends Error {}

/**
 * Posts one message to an incoming webhook, treating anything but a 2xx as a
 * refusal — a webhook that answers 404 has delivered nothing to anybody.
 */
export const postWebhook = async (url: string, text: string, timeoutMs = 10_000): Promise<void> => {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text }),
			signal: controller.signal,
		})

		if (!response.ok) {
			const body = (await response.text()).slice(0, 200)
			throw new WebhookFailure(`answered ${response.status}: ${body}`)
		}
	} catch (cause) {
		if (cause instanceof WebhookFailure) throw cause
		const detail = cause instanceof Error ? cause.message : String(cause)
		throw new WebhookFailure(detail)
	} finally {
		clearTimeout(timeout)
	}
}
