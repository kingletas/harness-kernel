#!/usr/bin/env bash
#
# Prove that each defect the stub can carry produces a non-zero exit and names
# itself, and that the healthy target says nothing at all.
#
# A green run proves nothing about the alarm and a firing alarm proves nothing
# about the quiet, so both directions are asserted here rather than one.
#
# The defect runs pass --no-record, because this script is the definitive
# arranged experiment: every fault it injects is one it chose, and a ledger that
# learned from them would be recording facts about this script rather than about
# any check. That sparing is itself asserted below, in both directions — a run
# that spares the ledgers is only interesting if a run that does not moves them.
#
# Usage:  prove-alarm.sh
# Exit:   0 when every direction behaved, 1 otherwise.
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$here" || exit 1

fails=0
ok()  { printf '  \033[32mok  \033[0m %s\n' "$1"; }
bad() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails + 1)); }

# The quiet direction. Two runs: the first establishes the known exception, the
# second must be byte-empty.
./bin/harness-selfcheck selfcheck >/dev/null 2>&1
quiet=$(./bin/harness-selfcheck selfcheck 2>&1)
if [[ -z "$quiet" ]]; then
	ok "a healthy target produces no output"
else
	bad "a healthy target printed $(wc -c <<<"$quiet") bytes"
fi

# The loud direction, one defect at a time.
for defect in session-less-read refuses-connections; do
	output=$(./bin/harness-selfcheck selfcheck --defect "$defect" --no-record 2>&1)
	status=$?
	if [[ $status -eq 0 ]]; then
		bad "${defect}: exited 0"
	elif ! grep -q FAIL <<<"$output"; then
		bad "${defect}: exited ${status} but named no failure"
	else
		ok "${defect}: exited ${status} and named the failure"
	fi
done

# `intermittent` must NOT be red: a route that failed once and then worked is a
# statement about the suite, not about the target.
if ./bin/harness-selfcheck selfcheck --defect intermittent --no-record >/dev/null 2>&1; then
	ok "an intermittent route does not turn the run red"
else
	bad "an intermittent route turned the run red"
fi

# --- the run that teaches nothing ---
#
# Everything a later run reads back, for the stub. The stub drives no browser, so
# it has no drift ledger; that one is spared by the same branch as the signature.
ledger_files=(
	baselines/stub--local--selfcheck.signature
	baselines/stub--local--selfcheck.measurements.json
	ledger/stub.flake.json
	baselines/stub--local--selfcheck.notify.json
)

fingerprint() {
	local file
	for file in "${ledger_files[@]}"; do
		if [[ -f $file ]]; then printf '%s %s\n' "$file" "$(md5sum <"$file")"; else printf '%s absent\n' "$file"; fi
	done
}

# Put the ledgers back however they were found. This script must not be the
# reason a check has a history, which is the whole point it is making.
snapshot=$(mktemp -d)
restore() {
	local file
	for file in "${ledger_files[@]}"; do
		if [[ -f "${snapshot}/$(basename "$file")" ]]; then
			cp "${snapshot}/$(basename "$file")" "$file"
		else
			rm -f "$file"
		fi
	done
	rm -rf "$snapshot"
}
trap restore EXIT

for file in "${ledger_files[@]}"; do
	[[ -f $file ]] && cp "$file" "${snapshot}/$(basename "$file")"
done

before=$(fingerprint)
output=$(./bin/harness-selfcheck selfcheck --defect session-less-read --no-record 2>&1)
if [[ "$(fingerprint)" == "$before" ]]; then
	ok "a --no-record run leaves every ledger byte-identical"
else
	bad "a --no-record run moved a ledger"
fi

if grep -q 'no-record: this run teaches nothing' <<<"$output"; then
	ok "a --no-record run says so in its own output"
else
	bad "a --no-record run did not say it was not recording"
fi

# The counter-direction, and it is the half that gives the one above any content:
# if the same run recorded nothing either, the assertion would hold against a
# harness that had stopped writing the ledger altogether.
before=$(fingerprint)
./bin/harness-selfcheck selfcheck --defect session-less-read >/dev/null 2>&1
if [[ "$(fingerprint)" != "$before" ]]; then
	ok "a recording run does move the ledger, so the check above has content"
else
	bad "a recording run moved nothing — the --no-record check proves nothing"
fi

# And the other half of the row: history that should not have been kept can be
# dropped. The run just above is exactly that — an arranged failure.
# Captured rather than piped: `set -o pipefail` is on, and grep -q closing the
# pipe early makes the command upstream of it exit on SIGPIPE, so the pipeline's
# status is a race rather than a verdict.
forget=$(./bin/harness-selfcheck flakes --forget selfcheck.session-less-read 2>&1)
if grep -q 'forgot selfcheck.session-less-read' <<<"$forget"; then
	if grep -q 'selfcheck.session-less-read' ledger/stub.flake.json 2>/dev/null; then
		bad "flakes --forget reported success and the history is still there"
	else
		ok "flakes --forget drops an arranged run's history"
	fi
else
	bad "flakes --forget did not drop the history it was given"
fi

if ./bin/harness-selfcheck flakes --forget selfcheck.no-such-check >/dev/null 2>&1; then
	bad "flakes --forget reported success for a check no ledger holds"
else
	ok "flakes --forget refuses an id no ledger holds"
fi

# --- a run that is wider than one ---
#
# Concurrency is only usable if a wide run says the same thing a narrow one
# does. All three directions below are about that, and each has a defect it is
# the only one to catch: a pool that reports in completion order, a circuit that
# counts completions rather than contacts, and a measurement folded into a
# baseline it is not comparable with.

verdicts() {
	./bin/harness-selfcheck selfcheck --seed fixed --workers "$1" --verbose --no-record 2>&1 |
		sed -e 's/\x1b\[[0-9;]*m//g' |
		grep -E '^  (ok|n/a|FAIL|BLOCK|slow|flake|held) ' || true
}

narrow=$(verdicts 1)
wide=$(verdicts 4)
if [[ "$narrow" == "$wide" && -n "$narrow" ]]; then
	ok "a wide run reports the same checks, in the same order, as a narrow one"
else
	bad "width changed what the run reported"
fi

# A dead target is one fact however many workers met it: at most one line for
# the checks that tried and reached nothing, and one for the checks that never
# ran at all. Both widths, because they fold different things — at width 1 most
# checks are blocked by the open circuit, and at width 4 most of them were
# already in flight when it opened.
for width in 1 4; do
	dead=$(./bin/harness-selfcheck selfcheck --defect refuses-connections --workers "$width" --no-record 2>&1 |
		sed -e 's/\x1b\[[0-9;]*m//g')
	spoke=$(grep -cE '^  (FAIL|BLOCK) ' <<<"$dead" || true)
	unrun=$(grep -cE '^  BLOCK ' <<<"$dead" || true)
	if [[ "$spoke" -le 2 && "$unrun" -le 1 ]]; then
		ok "a dead target is ${spoke} line(s) at width ${width}, not one per check"
	else
		bad "a dead target printed ${spoke} line(s) (${unrun} blocked) at width ${width}"
	fi
done

# A number measured while the harness is loading the target is not comparable
# with the history, so a wide run must not contribute one. The counter-direction
# is the half that gives it content: a narrow run has to move the same file.
measurements() { md5sum <baselines/stub--local--selfcheck.measurements.json 2>/dev/null || echo absent; }

before=$(measurements)
./bin/harness-selfcheck selfcheck --workers 4 >/dev/null 2>&1
if [[ "$(measurements)" == "$before" ]]; then
	ok "a wide run contributes no measurement to the baseline"
else
	bad "a wide run taught the measurement baseline"
fi

before=$(measurements)
./bin/harness-selfcheck selfcheck >/dev/null 2>&1
if [[ "$(measurements)" != "$before" ]]; then
	ok "a narrow run does move it, so the check above has content"
else
	bad "a narrow run moved nothing — the width check proves nothing"
fi

# --- somebody is told ---
#
# The channel has the same two directions as everything else here. The selfcheck
# tells nobody unless --notify is passed, because the stub is told what to be and
# an arranged defect must never reach a person who did not arrange it.

# A channel described wrongly is refused before a single check runs, which is
# what stops a typo costing a suite to discover.
started=$SECONDS
misconfigured=$(HARNESS_NOTIFY=mail HARNESS_NOTIFY_SMTP=127.0.0.1:1 \
	./bin/harness-selfcheck selfcheck --notify --no-record 2>&1)
status=$?
if [[ $status -eq 2 ]] && grep -q 'HARNESS_NOTIFY_TO is not set' <<<"$misconfigured" &&
	[[ $((SECONDS - started)) -lt 5 ]]; then
	ok "a half-described channel is refused in seconds, before the suite runs"
else
	bad "a half-described channel exited ${status} after $((SECONDS - started))s"
fi

# A channel that cannot be reached is loud and exits 3. Nobody was told, so the
# run must not be able to say 0 and must not record the story as delivered.
undelivered=$(HARNESS_NOTIFY=mail HARNESS_NOTIFY_SMTP=127.0.0.1:1 HARNESS_NOTIFY_TO=nobody@localhost \
	./bin/harness-selfcheck selfcheck --defect session-less-read --notify --no-record 2>&1)
status=$?
if [[ $status -eq 3 ]] && grep -q 'could not be told' <<<"$undelivered"; then
	ok "a channel that refuses the message exits 3 and says so"
else
	bad "an undelivered alert exited ${status}"
fi

if [[ ! -f baselines/stub--local--selfcheck.notify.json ]]; then
	ok "a run that told nobody recorded nothing as sent"
else
	bad "an undelivered alert wrote notification state"
fi

# The quiet direction, and the one that matters most: a green run with a channel
# configured must still say nothing to anybody.
./bin/harness-selfcheck selfcheck --notify >/dev/null 2>&1
quiet=$(HARNESS_NOTIFY=mail HARNESS_NOTIFY_SMTP=127.0.0.1:1 HARNESS_NOTIFY_TO=nobody@localhost \
	./bin/harness-selfcheck selfcheck --notify 2>&1)
status=$?
if [[ $status -eq 0 ]]; then
	ok "a healthy run never reaches the channel, so it cannot fail to deliver"
else
	bad "a healthy run tried to tell somebody and exited ${status}: ${quiet}"
fi

# --- one run at a time per target ---
#
# A schedule firing while the last run is still going would have two suites
# writing one set of ledgers. Both directions matter: a live holder must stop a
# run, and a holder that is gone must never stop one for ever.

lock=results/.locks/stub--local.lock
mkdir -p results/.locks
rm -f "$lock"

# A holder that is alive: this shell, which is by definition running.
printf '{"pid": %d, "host": "%s", "runId": "made-up", "since": "%s"}\n' \
	"$$" "$(hostname)" "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" >"$lock"
busy=$(./bin/harness-selfcheck selfcheck --no-record 2>&1)
status=$?
if [[ $status -eq 0 ]] && grep -q 'already in flight' <<<"$busy" && grep -q 'made-up' <<<"$busy"; then
	ok "a second run against a busy target does nothing and names the holder"
else
	bad "a second run exited ${status}: ${busy}"
fi

if [[ -f $lock ]] && grep -q 'made-up' "$lock"; then
	ok "and it left the holder's lock alone"
else
	bad "a refused run deleted a lock it did not hold"
fi

# A holder that is gone. PID 2^22 is above every pid_max in use and owns nothing.
printf '{"pid": 4194303, "host": "%s", "runId": "crashed", "since": "%s"}\n' \
	"$(hostname)" "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" >"$lock"
taken=$(./bin/harness-selfcheck selfcheck --no-record 2>&1)
if grep -q 'took over a lock left by run crashed' <<<"$taken"; then
	ok "a lock whose process is gone is taken over rather than obeyed for ever"
else
	bad "a dead holder's lock stopped the run: ${taken}"
fi

if [[ ! -f $lock ]]; then
	ok "a finished run leaves no lock behind"
else
	bad "the run kept its lock after finishing"
	rm -f "$lock"
fi

echo
[[ $fails -eq 0 ]] || { echo "  ${fails} direction(s) misbehaved"; exit 1; }
echo "  every direction behaved"
