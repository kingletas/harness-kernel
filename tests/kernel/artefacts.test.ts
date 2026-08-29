import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ArtefactStore } from '../../src/kernel/artefacts.js'

const store = (budget?: number) =>
	new ArtefactStore(mkdtempSync(join(tmpdir(), 'artefacts-')), budget)

const write = (dir: string, name: string, bytes: number): string => {
	const path = join(dir, name)
	writeFileSync(path, Buffer.alloc(bytes))
	return path
}

describe('ArtefactStore', () => {
	it('attaches what a check actually wrote, relative to the run', () => {
		const kept = store()
		const dir = kept.dirFor('a.check')
		kept.claim('a.check', 'trace', write(dir, 'trace.zip', 100))

		const { artefacts } = kept.collect('a.check')

		assert.equal(artefacts.length, 1)
		assert.equal(artefacts[0]?.kind, 'trace')
		assert.equal(artefacts[0]?.bytes, 100)
		assert.equal(artefacts[0]?.path, 'artefacts/a.check/trace.zip')
	})

	it('drops a claim on a file that was never written', () => {
		// A producer that decided the run was healthy and discarded its recording
		// must not leave a report pointing at nothing.
		const kept = store()
		kept.dirFor('a.check')
		kept.claim('a.check', 'video', '/nowhere/at/all.webm')

		assert.deepEqual(kept.collect('a.check').artefacts, [])
	})

	it('stops and says so once the run has spent its budget', () => {
		const kept = store(150)
		const dir = kept.dirFor('a.check')
		kept.claim('a.check', 'trace', write(dir, 'one.zip', 100))
		kept.claim('a.check', 'trace', write(dir, 'two.zip', 100))

		const { artefacts, dropped } = kept.collect('a.check')

		assert.equal(artefacts.length, 1)
		assert.match(dropped ?? '', /more than it may keep/)
		assert.equal(kept.accepting, false)
	})

	it('deletes what it refused rather than leaving it on the disk', () => {
		// Reporting a file as dropped and leaving it behind fills the disk it was
		// bounded to protect.
		const kept = store(150)
		const dir = kept.dirFor('a.check')
		kept.claim('a.check', 'trace', write(dir, 'one.zip', 100))
		kept.claim('a.check', 'trace', write(dir, 'two.zip', 100))
		kept.collect('a.check')

		assert.deepEqual(readdirSync(dir), ['one.zip'])
	})

	it('offers no directory once it has stopped accepting', () => {
		const kept = store(10)
		const dir = kept.dirFor('a.check')
		kept.claim('a.check', 'trace', write(dir, 'big.zip', 100))
		kept.collect('a.check')

		assert.equal(kept.accepting, false)
	})

	it("keeps one check's claims out of another's", () => {
		const kept = store()
		const dir = kept.dirFor('one.check')
		kept.claim('one.check', 'trace', write(dir, 'trace.zip', 10))

		assert.deepEqual(kept.collect('two.check').artefacts, [])
		assert.equal(kept.collect('one.check').artefacts.length, 1)
	})
})

describe('a check that needs no explaining leaves nothing', () => {
	it('removes the directory it was given', () => {
		const kept = store()
		const dir = kept.dirFor('a.check')
		write(dir, 'trace.zip', 100)

		kept.discard('a.check')

		assert.equal(existsSync(dir), false)
	})

	it('removes a directory whose claims all came to nothing', () => {
		// Playwright leaves an empty video folder behind even when the recording is
		// deleted, and a tree of those reads as though every check produced evidence.
		const kept = store()
		const dir = kept.dirFor('a.check')
		mkdirSync(join(dir, 'video'))
		kept.claim('a.check', 'video', join(dir, 'video', 'never-written.webm'))

		assert.deepEqual(kept.collect('a.check').artefacts, [])
		assert.equal(existsSync(dir), false)
	})
})
