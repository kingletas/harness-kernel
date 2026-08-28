import { join } from 'node:path'
import { Quarantine } from '../../history/quarantine.js'
import type { Harness } from '../harness.js'

/**
 * Lists what is held out of the verdict and what is asking to be; the ledger
 * notices, and a person accepts with a reason and an expiry.
 */
export const quarantineCommand = (harness: Harness, argv: readonly string[]): number => {
	const path = join(harness.workspace.ledger, 'quarantine.json')
	const held = Quarantine.load(path)
	const now = new Date()

	if (argv[0] === 'add') {
		const id = argv[1]
		const valueAfter = (flag: string): string | undefined => {
			const index = argv.indexOf(flag)
			return index === -1 ? undefined : argv[index + 1]
		}
		const reason = valueAfter('--reason')
		const days = Number(valueAfter('--days') ?? '14')

		if (id === undefined || reason === undefined || !Number.isFinite(days) || days <= 0) {
			process.stderr.write(
				'usage: houndbot quarantine add <check-id> --reason "why" [--days 14]\n' +
					'  A reason and an expiry are both required. An entry that never expires\n' +
					'  turns the list into a graveyard of checks nobody has to fix.\n',
			)
			return 2
		}

		const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
		held
			.with({
				id,
				reason,
				since: now.toISOString(),
				until: until.toISOString(),
				flakeRate: 0,
			})
			.save(path)

		process.stdout.write(
			`  ${id} is held out until ${until.toISOString().slice(0, 10)} — ${reason}\n`,
		)
		return 0
	}

	const entries = held.all()
	if (entries.length === 0) process.stdout.write('  nothing is quarantined\n')
	for (const entry of entries) {
		const live = new Date(entry.until).getTime() > now.getTime()
		process.stdout.write(
			`  ${live ? 'held ' : 'lapsed'} ${entry.id} until ${entry.until.slice(0, 10)} — ${entry.reason}\n`,
		)
	}

	return 0
}
