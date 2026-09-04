import { channelFromEnvironment, ChannelMisconfigured } from '../../reporting/notify.js'
import type { Harness } from '../harness.js'

/**
 * Sends one message end to end, because a channel is only wired when something
 * has actually arrived at the other end of it.
 */
export const testChannel = async (harness: Harness): Promise<number> => {
	let channel
	try {
		channel = channelFromEnvironment()
	} catch (cause) {
		if (!(cause instanceof ChannelMisconfigured)) throw cause
		process.stderr.write(`${harness.name}: ${cause.message}\n`)
		return 2
	}

	if (channel === undefined) {
		process.stderr.write(
			`${harness.name}: HARNESS_NOTIFY is not set, so no run would tell anybody\n` +
				'  Set it to mail or webhook, with the variables that channel needs.\n',
		)
		return 2
	}

	try {
		await channel.deliver({
			subject: `${harness.name}: a test message`,
			body: `Sent by ${harness.name} notify --test at ${new Date().toISOString()}.\nNo run produced this, and no check failed.`,
		})
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause)
		process.stderr.write(
			`${harness.name}: ${channel.name} (${channel.where}) refused it — ${detail}\n`,
		)
		return 3
	}

	process.stdout.write(`  sent one message to ${channel.name}: ${channel.where}\n`)
	return 0
}
