import { createConnection, type Socket } from 'node:net'

const CRLF = '\r\n'

/** Where a message goes, and who it claims to be from. */
export interface MailAddressing {
	readonly host: string
	readonly port: number
	readonly from: string
	readonly to: string
}

export interface MailMessage {
	readonly subject: string
	readonly body: string
}

/** A message the server refused, or a conversation that never got that far. */
export class MailFailure extends Error {}

/**
 * A reply is finished when a line carries its code followed by a space; every
 * earlier line of a multi-line reply separates the code with a hyphen.
 */
const completeReply = (
	buffer: string,
): { code: number; text: string; rest: string } | undefined => {
	const lines = buffer.split(CRLF)
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^(\d{3}) /.exec(lines[index] ?? '')
		if (match !== null) {
			return {
				code: Number(match[1]),
				text: lines
					.slice(0, index + 1)
					.join(' ')
					.trim(),
				rest: lines.slice(index + 1).join(CRLF),
			}
		}
	}
	return undefined
}

/** One SMTP conversation, which fails rather than waiting for a server that stopped talking. */
class Conversation {
	private buffer = ''
	private waiting: { resolve: () => void; reject: (error: Error) => void } | undefined
	private failure: Error | undefined

	constructor(private readonly socket: Socket) {
		socket.setEncoding('utf8')
		socket.on('data', chunk => {
			this.buffer += String(chunk)
			this.settle()
		})
		const die = (message: string) => {
			this.failure ??= new MailFailure(message)
			this.settle()
		}
		socket.on('error', error => die(`${error.message}`))
		socket.on('timeout', () => die('the server stopped answering'))
		socket.on('close', () => die('the server closed the connection'))
	}

	private settle(): void {
		if (this.waiting === undefined) return
		if (this.failure !== undefined) {
			const { reject } = this.waiting
			this.waiting = undefined
			reject(this.failure)
			return
		}
		if (completeReply(this.buffer) === undefined) return
		const { resolve } = this.waiting
		this.waiting = undefined
		resolve()
	}

	/** Waits for one complete reply and refuses any code the caller did not ask for. */
	async expect(code: number, what: string): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			this.waiting = { resolve, reject }
			this.settle()
		})

		const reply = completeReply(this.buffer)
		if (reply === undefined) throw new MailFailure(`${what}: the server said nothing usable`)
		this.buffer = reply.rest
		if (reply.code !== code) throw new MailFailure(`${what}: the server said "${reply.text}"`)
	}

	say(line: string): void {
		this.socket.write(`${line}${CRLF}`)
	}
}

/** A line beginning with a dot would end the message early, so it is doubled. */
const stuffed = (body: string): string =>
	body
		.split('\n')
		.map(line => (line.startsWith('.') ? `.${line}` : line))
		.join(CRLF)

/** A header value carrying a newline is a second header somebody else wrote. */
const oneLine = (value: string, field: string): string => {
	if (/[\r\n]/.test(value)) throw new MailFailure(`${field} contains a line break`)
	return value
}

/**
 * Sends one message over plain SMTP with no authentication, which is what a
 * local mail sink offers and the only thing this is pointed at.
 */
export const sendMail = async (
	addressing: MailAddressing,
	message: MailMessage,
	timeoutMs = 10_000,
): Promise<void> => {
	const from = oneLine(addressing.from, 'from')
	const to = oneLine(addressing.to, 'to')
	const subject = oneLine(message.subject, 'subject')

	const socket = createConnection({ host: addressing.host, port: addressing.port })
	socket.setTimeout(timeoutMs)
	const talk = new Conversation(socket)

	try {
		await talk.expect(220, 'connecting')
		talk.say('EHLO harness')
		await talk.expect(250, 'EHLO')
		talk.say(`MAIL FROM:<${from}>`)
		await talk.expect(250, 'MAIL FROM')
		talk.say(`RCPT TO:<${to}>`)
		await talk.expect(250, 'RCPT TO')
		talk.say('DATA')
		await talk.expect(354, 'DATA')

		const headers = [
			`From: ${from}`,
			`To: ${to}`,
			`Subject: ${subject}`,
			`Date: ${new Date().toUTCString()}`,
			'MIME-Version: 1.0',
			'Content-Type: text/plain; charset=utf-8',
		].join(CRLF)
		socket.write(`${headers}${CRLF}${CRLF}${stuffed(message.body)}${CRLF}.${CRLF}`)
		await talk.expect(250, 'the message body')

		talk.say('QUIT')
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause)
		throw new MailFailure(`${addressing.host}:${addressing.port}: ${detail}`)
	} finally {
		socket.destroy()
	}
}
