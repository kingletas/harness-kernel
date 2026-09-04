import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { acquireLock, releaseLock } from '../../src/kernel/lock.js'

const lockPath = (): string => join(mkdtempSync(join(tmpdir(), 'lock-')), 'nemesis--local.lock')

const alive = () => true
const dead = () => false

describe('one run at a time per target', () => {
	it('lets the first run have it', () => {
		const outcome = acquireLock(lockPath(), {
			runId: 'first',
			pid: 111,
			host: 'box',
			isAlive: alive,
		})
		assert.equal(outcome.held, true)
	})

	it('refuses the second, and names who is holding it', () => {
		const path = lockPath()
		acquireLock(path, { runId: 'first', pid: 111, host: 'box', isAlive: alive })
		const second = acquireLock(path, { runId: 'second', pid: 222, host: 'box', isAlive: alive })

		assert.equal(second.held, false)
		assert.equal(!second.held && second.holder.runId, 'first')
		assert.equal(!second.held && second.holder.pid, 111)
	})

	it('says how long the holder has had it, so a stuck run can be told from a slow one', () => {
		const path = lockPath()
		acquireLock(path, {
			runId: 'first',
			pid: 111,
			host: 'box',
			isAlive: alive,
			now: new Date('2026-09-04T00:00:00.000Z'),
		})
		const second = acquireLock(path, {
			runId: 'second',
			pid: 222,
			host: 'box',
			isAlive: alive,
			now: new Date('2026-09-04T03:00:00.000Z'),
		})

		assert.equal(!second.held && second.ageMs, 3 * 60 * 60 * 1000)
	})

	it('takes over a lock whose process is gone', () => {
		// A run killed mid-flight must not stop every later run for ever. This is
		// the half that makes the mechanism usable rather than a trap.
		const path = lockPath()
		acquireLock(path, { runId: 'crashed', pid: 111, host: 'box', isAlive: alive })
		const next = acquireLock(path, { runId: 'next', pid: 222, host: 'box', isAlive: dead })

		assert.equal(next.held, true)
		assert.equal(next.held && next.reclaimed?.runId, 'crashed')
	})

	it('never takes over a lock held on another machine', () => {
		// Nothing here can tell whether a process on another host is alive, and
		// guessing wrong runs two suites against one target.
		const path = lockPath()
		acquireLock(path, { runId: 'elsewhere', pid: 111, host: 'other-box', isAlive: alive })
		const next = acquireLock(path, { runId: 'next', pid: 222, host: 'box', isAlive: dead })

		assert.equal(next.held, false)
	})

	it('takes over a lock a run was killed halfway through writing', () => {
		const path = lockPath()
		writeFileSync(path, '{"pid": 1', 'utf8')
		const next = acquireLock(path, { runId: 'next', pid: 222, host: 'box', isAlive: dead })

		assert.equal(next.held, true)
	})

	it('releases it, so the next run may have it', () => {
		const path = lockPath()
		const first = acquireLock(path, { runId: 'first', pid: 111, host: 'box', isAlive: alive })
		assert.equal(first.held, true)
		if (first.held) first.release()

		assert.equal(existsSync(path), false)
		assert.equal(
			acquireLock(path, { runId: 'second', pid: 222, host: 'box', isAlive: alive }).held,
			true,
		)
	})

	it('never releases a lock that is no longer its own', () => {
		// After a reclaim the file belongs to somebody else; a blind unlink here
		// would hand a third run a target two are already using.
		const path = lockPath()
		acquireLock(path, { runId: 'crashed', pid: 111, host: 'box', isAlive: alive })
		acquireLock(path, { runId: 'next', pid: 222, host: 'box', isAlive: dead })

		releaseLock(path, { runId: 'crashed', pid: 111, host: 'box', since: '' })
		assert.equal(existsSync(path), true)
	})
})
