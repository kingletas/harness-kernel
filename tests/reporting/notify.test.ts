import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { observe, type Observation } from '../../src/kernel/observation.js'
import { startRun } from '../../src/kernel/run.js'
import type { Verdict } from '../../src/kernel/verdict.js'
import {
	channelFromEnvironment,
	ChannelMisconfigured,
	notify,
	type Channel,
	type Notification,
} from '../../src/reporting/notify.js'
import { summarize } from '../../src/reporting/summary.js'
import { sendMail } from '../../src/surfaces/smtp.js'
import { postWebhook, WebhookFailure } from '../../src/surfaces/webhook.js'

const run = startRun({ target: 'stub', environment: 'local', suites: ['selfcheck'], seed: 'fixed' })

const at = (id: string, verdict: Verdict): Observation =>
	observe({
		id,
		title: id,
		suite: 't',
		target: 'stub',
		runId: run.id,
		verdict,
		...(verdict === 'pass' ? {} : { reason: 'the surface answered 500' }),
		durationMs: 1,
		startedAt: run.startedAt,
	})

/** A channel that remembers what it was handed, or refuses everything. */
const spy = (refuse = false): Channel & { readonly sent: Notification[] } => {
	const sent: Notification[] = []
	return {
		name: 'spy',
		where: 'nowhere',
		sent,
		deliver: async (message: Notification) => {
			if (refuse) throw new Error('the sink refused the connection')
			sent.push(message)
		},
	}
}

const tell = async (channel: Channel, statePath: string, observations: Observation[]) =>
	notify({
		channel,
		statePath,
		name: 'drexbot',
		run,
		observations,
		summary: summarize(observations),
	})

const tempPath = (): string => join(mkdtempSync(join(tmpdir(), 'notify-')), 'notify.json')

describe('telling somebody', () => {
	it('says nothing about a green run', async () => {
		const channel = spy()
		const outcome = await tell(channel, tempPath(), [at('a', 'pass')])

		assert.equal(outcome.told, false)
		assert.deepEqual(channel.sent, [])
	})

	it('hands over what the console would have said, so the two cannot disagree', async () => {
		const channel = spy()
		await tell(channel, tempPath(), [at('a', 'fail'), at('b', 'pass')])

		const [message] = channel.sent
		assert.equal(message?.subject, 'drexbot stub/local: 1 failing')
		assert.match(message?.body ?? '', /FAIL\s+a/)
		assert.match(message?.body ?? '', /the surface answered 500/)
		assert.match(message?.body ?? '', /drexbot stub\/local/)
	})

	it('advances nothing when the channel refuses, so the next run says it again', async () => {
		// A delivery that failed and was recorded as sent is the worst outcome
		// this row can have: nobody was told and nothing will ever say so again.
		const path = tempPath()
		const refusing = spy(true)
		const failed = await tell(refusing, path, [at('a', 'fail')])

		assert.equal(failed.told, false)
		assert.match(failed.failure ?? '', /refused the connection/)
		assert.equal(existsSync(path), false, 'a refused delivery wrote state anyway')

		const working = spy()
		const retried = await tell(working, path, [at('a', 'fail')])
		assert.equal(retried.told, true)
		assert.equal(working.sent.length, 1)
	})

	it('goes quiet once the same story has been delivered', async () => {
		const path = tempPath()
		const channel = spy()
		await tell(channel, path, [at('a', 'fail')])
		const second = await tell(channel, path, [at('a', 'fail')])

		assert.equal(second.told, false)
		assert.equal(channel.sent.length, 1)
	})
})

describe('the channel an environment asks for', () => {
	it('is nobody when nothing asked for one', () => {
		assert.equal(channelFromEnvironment({}), undefined)
		assert.equal(channelFromEnvironment({ HARNESS_NOTIFY: 'none' }), undefined)
	})

	it('refuses a name it does not have', () => {
		assert.throws(() => channelFromEnvironment({ HARNESS_NOTIFY: 'slack' }), ChannelMisconfigured)
	})

	it('names the variable a half-described channel is missing', () => {
		assert.throws(
			() => channelFromEnvironment({ HARNESS_NOTIFY: 'mail', HARNESS_NOTIFY_SMTP: 'h:25' }),
			/HARNESS_NOTIFY_TO is not set/,
		)
		assert.throws(
			() => channelFromEnvironment({ HARNESS_NOTIFY: 'webhook' }),
			/HARNESS_NOTIFY_WEBHOOK is not set/,
		)
	})

	it('never prints the secret half of a webhook URL', () => {
		const channel = channelFromEnvironment({
			HARNESS_NOTIFY: 'webhook',
			HARNESS_NOTIFY_WEBHOOK: 'https://chat.test/hooks/xxxx-secret-token',
		})

		assert.equal(channel?.where, 'https://chat.test')
		assert.ok(!channel?.where.includes('secret'))
	})

	it('describes where a mail channel delivers', () => {
		const channel = channelFromEnvironment({
			HARNESS_NOTIFY: 'mail',
			HARNESS_NOTIFY_SMTP: '172.17.0.1:1025',
			HARNESS_NOTIFY_TO: 'ops@example.test',
		})

		assert.equal(channel?.where, 'ops@example.test via 172.17.0.1:1025')
	})
})

describe('the transports themselves', () => {
	it('refuses a subject that would write a second header', async () => {
		// A subject is attacker-controlled the moment a check's reason reaches it.
		await assert.rejects(
			sendMail(
				{ host: '127.0.0.1', port: 1, from: 'a@b', to: 'c@d' },
				{ subject: 'ok\r\nBcc: somebody@else', body: 'x' },
			),
			// Named rather than matched on the type: the port below refuses too, so
			// a type assertion here would pass against no header check at all.
			/subject contains a line break/,
		)
	})

	it('reports a mail sink that is not there', async () => {
		await assert.rejects(
			sendMail({ host: '127.0.0.1', port: 1, from: 'a@b', to: 'c@d' }, { subject: 'x', body: 'y' }),
			/127\.0\.0\.1:1/,
		)
	})

	it('treats a webhook answering 404 as having delivered nothing', async () => {
		const server = createServer((_request, response) => {
			response.writeHead(404)
			response.end('no such hook')
		})
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		const port = typeof address === 'object' && address !== null ? address.port : 0

		try {
			await assert.rejects(postWebhook(`http://127.0.0.1:${port}/hook`, 'x'), WebhookFailure)
		} finally {
			server.close()
		}
	})

	it('takes a webhook that accepts it', async () => {
		let received = ''
		const server = createServer((request, response) => {
			const chunks: Buffer[] = []
			request.on('data', chunk => chunks.push(chunk as Buffer))
			request.on('end', () => {
				received = Buffer.concat(chunks).toString('utf8')
				response.writeHead(200)
				response.end('ok')
			})
		})
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		const port = typeof address === 'object' && address !== null ? address.port : 0

		try {
			await postWebhook(`http://127.0.0.1:${port}/hook`, 'three checks failed')
			assert.match(received, /three checks failed/)
		} finally {
			server.close()
		}
	})
})
