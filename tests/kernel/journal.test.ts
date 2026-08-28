import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { Journal } from '../../src/kernel/journal.js'
import { observe } from '../../src/kernel/observation.js'
import { startRun } from '../../src/kernel/run.js'

const temporaryPath = (): string => join(mkdtempSync(join(tmpdir(), 'houndbot-')), 'run.jsonl')

const observation = (id: string) =>
	observe({
		id,
		title: id,
		suite: 't',
		target: 'stub',
		runId: 'run-1',
		verdict: 'pass',
		durationMs: 1,
		startedAt: '2026-08-27T00:00:00.000Z',
	})

describe('Journal', () => {
	it('reads back what it wrote', () => {
		const journal = Journal.at(temporaryPath())
		journal.append({
			kind: 'run-started',
			run: startRun({ target: 'stub', environment: 'local', suites: ['t'] }),
		})
		journal.append({ kind: 'observation', observation: observation('a') })

		assert.equal(journal.read().length, 2)
	})

	it('names the checks already done, so a resumed run skips them', () => {
		const journal = Journal.at(temporaryPath())
		journal.append({ kind: 'observation', observation: observation('a') })
		journal.append({ kind: 'observation', observation: observation('b') })

		assert.deepEqual([...journal.completed()].sort(), ['a', 'b'])
	})

	it('keeps everything before a line a killed run left half-written', () => {
		const path = temporaryPath()
		const journal = Journal.at(path)
		journal.append({ kind: 'observation', observation: observation('a') })
		appendFileSync(path, '{"kind":"observation","observ', 'utf8')

		assert.deepEqual([...journal.completed()], ['a'])
	})

	it('is empty rather than absent before anything has been written', () => {
		assert.deepEqual(Journal.at(temporaryPath()).read(), [])
	})
})
