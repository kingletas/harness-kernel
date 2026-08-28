import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { Quarantine, type QuarantineEntry } from '../../src/history/quarantine.js'

const entry = (id: string, until: string): QuarantineEntry => ({
	id,
	reason: 'races against the indexer',
	since: '2026-08-01T00:00:00.000Z',
	until,
	flakeRate: 0.3,
})

const now = new Date('2026-08-27T00:00:00.000Z')

describe('Quarantine', () => {
	it('holds a check whose window is still open', () => {
		const quarantine = Quarantine.from([entry('a', '2026-09-01T00:00:00.000Z')])
		assert.equal(quarantine.entryFor('a', now)?.id, 'a')
	})

	it('lets go of a check whose window has closed', () => {
		// An entry that never expires turns the list into a graveyard of checks
		// nobody has to fix, which is quieter and worse than a red suite.
		const quarantine = Quarantine.from([entry('a', '2026-08-20T00:00:00.000Z')])
		assert.equal(quarantine.entryFor('a', now), undefined)
		assert.deepEqual(
			quarantine.expired(now).map(item => item.id),
			['a'],
		)
	})

	it('knows nothing about a check that was never quarantined', () => {
		assert.equal(Quarantine.empty().entryFor('a', now), undefined)
	})

	it('survives a round trip through a file', () => {
		const path = join(mkdtempSync(join(tmpdir(), 'houndbot-')), 'quarantine.json')
		Quarantine.from([entry('a', '2026-09-01T00:00:00.000Z')]).save(path)

		assert.equal(Quarantine.load(path).entryFor('a', now)?.reason, 'races against the indexer')
	})

	it('is empty when there is no file yet', () => {
		assert.equal(Quarantine.load('/nonexistent/quarantine.json').entryFor('a', now), undefined)
	})
})
