import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	ScheduleRefused,
	serviceUnit,
	timerUnit,
	unitBase,
	type ScheduleSpec,
} from '../../src/schedule/systemd.js'

const spec: ScheduleSpec = {
	name: 'houndbot',
	target: 'nemesis',
	onCalendar: 'daily',
	command: '/home/somebody/harness/bin/houndbot',
	workingDirectory: '/home/somebody/harness',
}

describe('the units a schedule is made of', () => {
	it('runs a missed window once the machine comes back', () => {
		// Most of what surviving a reboot means: enabling persists on its own, but
		// a nightly run missed while the laptop was shut never happens without this.
		assert.match(timerUnit(spec), /^Persistent=true$/m)
	})

	it('installs the timer and never the service', () => {
		// A service carrying [Install] is started at boot as well as by the timer,
		// so the suite runs twice and the schedule is not the schedule.
		assert.match(timerUnit(spec), /\[Install]\nWantedBy=timers\.target/)
		assert.ok(!serviceUnit(spec).includes('[Install]'))
	})

	it('treats a red run as the unit having done its job', () => {
		// Without this a failing suite leaves the unit failed, and a failed unit is
		// a thing somebody resets rather than a finding somebody reads.
		assert.match(serviceUnit(spec), /SuccessExitStatus=0 1 3/)
	})

	it('keeps the channel own variables out of the unit', () => {
		const unit = serviceUnit({ ...spec })
		assert.match(unit, /EnvironmentFile=-%h\/\.config\/houndbot-nemesis\.env/)
		assert.ok(!unit.includes('HARNESS_NOTIFY'), 'a webhook URL carries its token')
	})

	it('names the suites when it was given some', () => {
		assert.match(
			serviceUnit({ ...spec, suites: ['smoke', 'session-less'] }),
			/--suite smoke,session-less/,
		)
		assert.ok(!serviceUnit(spec).includes('--suite'))
	})

	it('refuses a field that would write a second directive', () => {
		assert.throws(
			() => timerUnit({ ...spec, onCalendar: 'daily\nExecStart=/bin/sh' }),
			ScheduleRefused,
		)
		assert.throws(() => serviceUnit({ ...spec, command: '/bin/sh\nUser=root' }), ScheduleRefused)
	})

	it('refuses a field that is empty rather than writing a broken unit', () => {
		assert.throws(() => unitBase({ ...spec, target: '  ' }), ScheduleRefused)
	})
})
