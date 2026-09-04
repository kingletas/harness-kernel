import type { Defect } from '../../fixtures/stub-target.js'
import type { Harness } from './harness.js'

/** One extra command a tool adds to the shared set. */
export interface ExtraCommand {
	/** The line this command contributes to the usage block. */
	readonly usage: string
	run(harness: Harness, options: Options, argv: readonly string[]): Promise<number> | number
}

export const usageFor = (
	harness: Harness,
	extras: Readonly<Record<string, ExtraCommand>>,
): string =>
	`${harness.name} — regression, acceptance, behaviour and performance harness

Usage:
  ${harness.name} run --target <name> [--suite a,b] [options]
  ${harness.name} selfcheck [options]        Prove the harness against its own stub
  ${harness.name} targets                    List targets and the suites each offers
  ${harness.name} coverage [--target <name>] Check the sign-off sheet against the checks
  ${harness.name} probe --target <name>      Report whether the suite could drive this site
  ${harness.name} plan --target <name> [--changed]  Say what a diff would run, and run nothing
  ${harness.name} quarantine [add <id>]      List what is held out, and what is asking to be
  ${harness.name} flakes [--target <name>]   Checks whose recent history is inconsistent
  ${harness.name} flakes --forget <id>       Drop one check's history from the ledger
  ${harness.name} notify --test              Send one message to prove the channel works
  ${harness.name} schedule plan --target <name>    Print the units a schedule needs
  ${harness.name} schedule install --target <name> Write them, enabling nothing
  ${harness.name} schedule report [--days 7]       What every schedule has been doing
  ${harness.name} help
${Object.values(extras)
	.map(extra => `  ${harness.name} ${extra.usage}`)
	.join('\n')}

Options:
  --target <name>   Which target to ask. Known: ${harness.registry.names().join(', ')}
  --suite <a,b>     Suites to run. Default: every suite the target offers
  --url <url>       Override the target base URL
  --env <name>      Environment label recorded on the run
  --seed <value>    Replay the random choices of an earlier run
  --workers <n>     How many checks may be in flight at once. Default 1.
                    A wider run neither judges nor records measurements: a
                    number taken while the harness is loading the target is
                    not comparable with one taken alone
  --verbose         Report every check, not only what changed
  --no-record       Teach nothing: no signature, no measurement baseline, no
                    drift ledger and no flake ledger. Said out loud in the run's
                    own output, so a teaching run and a non-teaching one can
                    never be confused for each other
  --no-notify       Tell nobody about this run, whatever HARNESS_NOTIFY says.
                    Implied by --no-record
  --notify          Tell the channel even from a command that would not, which
                    is how the selfcheck is used to prove the channel at all
  --matrix          Print the sign-off sheet after the run
  --changed         Run only what a diff in the target's repository put at risk
  --since <ref>     What to diff against (default HEAD, i.e. uncommitted work)
  --strict          A measurement past its historical variance fails the run
  --defect <name>   selfcheck only: none, session-less-read, intermittent,
                    slow, refuses-connections

Environment:
  HARNESS_NOTIFY            none (default), mail or webhook
  HARNESS_NOTIFY_SMTP       mail: host:port of the sink
  HARNESS_NOTIFY_TO         mail: who is told
  HARNESS_NOTIFY_FROM       mail: who it claims to be from. Default harness@localhost
  HARNESS_NOTIFY_WEBHOOK    webhook: the incoming-webhook URL

Exit codes:
  0  nothing red
  1  a check failed, or the target could not be reached
  2  the command or its arguments were wrong
  3  the run finished and the channel could not be told; the verdict is above
`

export interface Options {
	readonly target: string | undefined
	readonly suites: readonly string[] | undefined
	readonly url: string | undefined
	readonly environment: string | undefined
	readonly seed: string | undefined
	/** How many checks may be in flight at once. */
	readonly workers: number
	readonly verbose: boolean
	/** Whether this run is allowed to leave anything behind for a later run to read. */
	readonly record: boolean
	/** Whether this run may tell the channel about itself; `on` overrides a command that would not. */
	readonly notify: 'auto' | 'on' | 'off'
	readonly degradedIsRed: boolean
	readonly matrix: boolean
	/** Narrow the run to what a diff in the target's repository put at risk. */
	readonly changed: boolean
	readonly since: string
	readonly defect: Defect
}

export const parse = (argv: readonly string[]): Options => {
	const valueAfter = (flag: string): string | undefined => {
		const index = argv.indexOf(flag)
		return index === -1 ? undefined : argv[index + 1]
	}

	const suites = valueAfter('--suite')

	return {
		target: valueAfter('--target'),
		suites: suites === undefined ? undefined : suites.split(',').map(name => name.trim()),
		url: valueAfter('--url'),
		environment: valueAfter('--env'),
		seed: valueAfter('--seed'),
		workers: Number(valueAfter('--workers') ?? '1'),
		verbose: argv.includes('--verbose'),
		record: !argv.includes('--no-record'),
		// A run that teaches nothing tells nobody either: an arranged experiment
		// that pages a person is indistinguishable from a real failure.
		notify: argv.includes('--notify')
			? 'on'
			: argv.includes('--no-notify') || argv.includes('--no-record')
				? 'off'
				: 'auto',
		degradedIsRed: argv.includes('--strict'),
		matrix: argv.includes('--matrix'),
		changed: argv.includes('--changed'),
		since: valueAfter('--since') ?? 'HEAD',
		defect: (valueAfter('--defect') ?? 'none') as Defect,
	}
}
