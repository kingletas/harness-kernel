import type { Observation } from '../kernel/observation.js'
import type { RunIdentity } from '../kernel/run.js'
import { VERDICTS, type Verdict } from '../kernel/verdict.js'
import {
	decideNotification,
	loadNotifyState,
	saveNotifyState,
	waitFor,
	HOLD_RUNS,
	type NotifyDecision,
} from '../history/notified.js'
import { sendMail } from '../surfaces/smtp.js'
import { postWebhook } from '../surfaces/webhook.js'
import { reportToConsole } from './console-reporter.js'
import type { Summary } from './summary.js'

export interface Notification {
	readonly subject: string
	readonly body: string
}

/** Somewhere a person actually reads, which the harness can hand a message to. */
export interface Channel {
	readonly name: string
	/** Where it delivers, named on the console so a silent channel is not a mystery. */
	readonly where: string
	deliver(message: Notification): Promise<void>
}

/** A channel asked for and not fully described, refused before any check runs. */
export class ChannelMisconfigured extends Error {}

type Environment = Readonly<Record<string, string | undefined>>

const required = (env: Environment, key: string, why: string): string => {
	const value = env[key]?.trim()
	if (value === undefined || value === '') {
		throw new ChannelMisconfigured(`${key} is not set, and ${why}`)
	}
	return value
}

const mailChannel = (env: Environment): Channel => {
	const [host = '', port = ''] = required(
		env,
		'HARNESS_NOTIFY_SMTP',
		'a mail channel has nowhere to deliver',
	).split(':')
	const to = required(env, 'HARNESS_NOTIFY_TO', 'a mail channel has nobody to deliver to')
	const from = env.HARNESS_NOTIFY_FROM?.trim() ?? 'harness@localhost'
	const addressing = { host, port: Number(port === '' ? '25' : port), from, to }

	if (host === '' || !Number.isInteger(addressing.port)) {
		throw new ChannelMisconfigured(
			`HARNESS_NOTIFY_SMTP should be host:port, not "${env.HARNESS_NOTIFY_SMTP ?? ''}"`,
		)
	}

	return {
		name: 'mail',
		where: `${to} via ${host}:${addressing.port}`,
		deliver: message => sendMail(addressing, message),
	}
}

const webhookChannel = (env: Environment): Channel => {
	const url = required(env, 'HARNESS_NOTIFY_WEBHOOK', 'a webhook channel has nowhere to deliver')
	if (!URL.canParse(url)) throw new ChannelMisconfigured(`HARNESS_NOTIFY_WEBHOOK is not a URL`)

	return {
		name: 'webhook',
		// The path carries the secret, so only the origin is ever printed.
		where: new URL(url).origin,
		deliver: message => postWebhook(url, `**${message.subject}**\n\`\`\`\n${message.body}\n\`\`\``),
	}
}

/**
 * The channel this environment asks for, resolved before a run rather than
 * after it, so a channel described wrongly costs no suite to discover.
 */
export const channelFromEnvironment = (env: Environment = process.env): Channel | undefined => {
	const kind = env.HARNESS_NOTIFY?.trim() ?? 'none'
	switch (kind) {
		case '':
		case 'none':
			return undefined
		case 'mail':
			return mailChannel(env)
		case 'webhook':
			return webhookChannel(env)
		default:
			throw new ChannelMisconfigured(`HARNESS_NOTIFY is "${kind}" — it takes none, mail or webhook`)
	}
}

const redCount = (summary: Summary): number => summary.counts.fail + summary.counts.blocked

const nonPassing = (summary: Summary): number =>
	VERDICTS.filter((verdict: Verdict) => verdict !== 'pass').reduce(
		(total, verdict) => total + summary.counts[verdict],
		0,
	)

const headline = (name: string, run: RunIdentity, summary: Summary, kind: string): string => {
	const where = `${name} ${run.target}/${run.environment}`
	if (kind === 'recovered') return `${where}: recovered`
	const failing = redCount(summary)
	return `${where}: ${failing} ${kind === 'again' ? 'still failing' : 'failing'}`
}

/**
 * Renders what the console would have said, so the channel and the terminal can
 * never tell two different stories about one run.
 */
export const renderNotification = (
	name: string,
	run: RunIdentity,
	observations: readonly Observation[],
	summary: Summary,
	decision: Extract<NotifyDecision, { send: true }>,
): Notification => {
	const lines: string[] = []
	const preamble =
		decision.kind === 'recovered'
			? `Green for ${HOLD_RUNS} consecutive runs, so this recovery has held.`
			: decision.kind === 'again'
				? `Unchanged since ${decision.since}. This is the same story, told for the ${decision.sends}th time, ${decision.runsSince} run(s) later; the next repeat is ${waitFor(decision.sends)} run(s) away unless it changes.`
				: `${nonPassing(summary)} of ${summary.total} checks are not passing.`

	lines.push(preamble)

	// What a recovery is a recovery from. A red run records no signature, so by
	// the time it clears the console has nothing changed to render and the
	// message would otherwise say only that something unnamed is better.
	if (decision.kind === 'recovered' && decision.wasTold !== '') {
		lines.push('', 'No longer reported:')
		for (const line of decision.wasTold.split('\n')) lines.push(`  ${line}`)
	}

	reportToConsole(run, observations, summary, {
		colour: false,
		name,
		write: line => lines.push(line),
	})

	return { subject: headline(name, run, summary, decision.kind), body: lines.join('\n') }
}

/** What the run should say on the console about who was told, and whether it worked. */
export interface NotifyOutcome {
	readonly told: boolean
	readonly why: string
	/** Set when the channel was asked and refused; the state is not advanced. */
	readonly failure?: string
}

export interface NotifyRequest {
	readonly channel: Channel
	readonly statePath: string
	readonly name: string
	readonly run: RunIdentity
	readonly observations: readonly Observation[]
	readonly summary: Summary
	/** False on a run that teaches nothing, so the state is read and never advanced. */
	readonly remember?: boolean
	readonly now?: Date
}

/**
 * Tells the channel about this run, or records that it did not need to. A
 * failed delivery advances nothing, so the next run says the same thing again.
 */
export const notify = async (request: NotifyRequest): Promise<NotifyOutcome> => {
	const state = loadNotifyState(request.statePath)
	const decision = decideNotification(state, request.summary, request.now)

	const remember = request.remember ?? true

	if (!decision.send) {
		if (remember) saveNotifyState(request.statePath, decision.next)
		return { told: false, why: decision.why }
	}

	const message = renderNotification(
		request.name,
		request.run,
		request.observations,
		request.summary,
		decision,
	)

	try {
		await request.channel.deliver(message)
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause)
		return { told: false, why: decision.kind, failure: detail }
	}

	if (remember) saveNotifyState(request.statePath, decision.next)
	return { told: true, why: decision.kind }
}
