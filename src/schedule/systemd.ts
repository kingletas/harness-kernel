/** What a scheduled run is: which tool, against what, how often, and from where. */
export interface ScheduleSpec {
	/** The tool's own name, which is also the unit's. */
	readonly name: string
	readonly target: string
	readonly suites?: readonly string[]
	/** A systemd calendar expression — `daily`, `hourly`, `*-*-* 02:00:00`. */
	readonly onCalendar: string
	/** Absolute path to the tool's entry point. */
	readonly command: string
	readonly workingDirectory: string
	/** Spread over this many seconds, so two timers on one machine do not fire together. */
	readonly jitterSeconds?: number
}

/** A spec whose fields would write something other than what they say. */
export class ScheduleRefused extends Error {}

/** A newline in any of these is a second directive somebody else wrote. */
const oneLine = (value: string, field: string): string => {
	if (/[\r\n]/.test(value)) throw new ScheduleRefused(`${field} contains a line break`)
	if (value.trim() === '') throw new ScheduleRefused(`${field} is empty`)
	return value
}

export const unitBase = (spec: ScheduleSpec): string =>
	`${oneLine(spec.name, 'name')}-${oneLine(spec.target, 'target')}`

const execStart = (spec: ScheduleSpec): string => {
	const suites = spec.suites?.length ? ` --suite ${oneLine(spec.suites.join(','), 'suites')}` : ''
	return `${oneLine(spec.command, 'command')} run --target ${spec.target}${suites}`
}

/**
 * The channel's own variables, read from a file the unit does not contain. A
 * webhook URL carries its token, and a unit file is world-readable by default.
 */
export const environmentFile = (spec: ScheduleSpec): string => `%h/.config/${unitBase(spec)}.env`

export const serviceUnit = (spec: ScheduleSpec): string =>
	`[Unit]
Description=${spec.name} against ${spec.target}
Documentation=https://github.com/kingletas/harness-kernel

[Service]
Type=oneshot
WorkingDirectory=${oneLine(spec.workingDirectory, 'workingDirectory')}
# The leading - makes the file optional: a schedule with no channel still runs.
EnvironmentFile=-${environmentFile(spec)}
ExecStart=${execStart(spec)}
# The run reports its own verdict; a red suite is not a broken unit, and telling
# systemd otherwise would put the timer into a failed state it never leaves.
SuccessExitStatus=0 1 3
`

export const timerUnit = (spec: ScheduleSpec): string =>
	`[Unit]
Description=${spec.name} against ${spec.target}, on a timer

[Timer]
OnCalendar=${oneLine(spec.onCalendar, 'onCalendar')}
# A run missed while the machine was off happens once it comes back, which is
# most of what surviving a reboot means.
Persistent=true
RandomizedDelaySec=${Math.max(0, Math.trunc(spec.jitterSeconds ?? 300))}
Unit=${unitBase(spec)}.service

[Install]
WantedBy=timers.target
`

/** The commands that turn written units into a schedule, which a person runs. */
export const enableCommands = (spec: ScheduleSpec): readonly string[] => [
	'systemctl --user daemon-reload',
	`systemctl --user enable --now ${unitBase(spec)}.timer`,
	// Without lingering, user timers stop when the last session closes and do not
	// come back until somebody logs in.
	`loginctl enable-linger ${process.env.USER ?? '$USER'}`,
	`systemctl --user list-timers ${unitBase(spec)}.timer`,
]
