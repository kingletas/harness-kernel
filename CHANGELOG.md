# Changelog

## 0.3.0

**A channel, so a run nobody is watching can still tell somebody.** `HARNESS_NOTIFY`
takes `mail` or `webhook`; the mail channel speaks plain SMTP to a local sink and
the webhook channel posts to an incoming hook. Neither adds a runtime dependency.

**It carries the console's silence contract rather than a copy of it.** The
message body is what the console would have printed, so the terminal and the
channel cannot tell two different stories about one run. A green run whose story
has not changed reaches the channel at all.

**A repeating failure backs off, and the backoff is held per story.** The same
failure is told again after 2 runs, then 4, 8, 16 and 32, so a fault lasting a
month is still reported monthly rather than either 30 times or never. Holding the
schedule per story rather than per channel is what stops two failures taking
turns from resetting each other and telling somebody every single run.

**A recovery has to hold for two runs before it is announced**, so a check
breaking every other run never reports itself fixed.

**A channel described wrongly is refused before the first check runs**, and a
message that could not be delivered exits **3** and records nothing as sent, so
the next run says the same thing again. `notify --test` sends one message end to
end, because a channel is only wired when something has arrived at the far end.

**`--no-record` now also tells nobody**, and `--notify` forces a command that
would not — which is how the selfcheck is used to prove the channel.

**A report no longer tells a reader to run another tool.** The console header and
the flake, quarantine and forget hints all named `houndbot`, whatever tool was
running: a drexbot failure advised a command that does not exist on that machine.

## 0.2.0

**Renamed from `@harness/kernel` to `harness-kernel`.** The old name sat in a
scope nobody here owns, so it could never be published — and npm 12 declines
git dependencies by default, which is what a consumer was left with. Update the
dependency name; nothing else about the API moved.

## 0.1.0

The first release, and the first one anybody else can install.

Extracted from `houndbot`, where it was built as the shared half of a harness
that tested a Magento storefront and the Hound backend from one package. The
full history to that point is in that repository.

The kernel knows no target: the registry and the workspace are handed to it, and
it reaches for neither. **Zero runtime dependencies** — what it installs is Node
and nothing else.

**Eight verdicts rather than two**, because pass and fail is how a suite becomes
noise. A check that cannot mean anything against a target reports `unsupported`
and names the missing capability; it never fails, and it is never silently
absent from the summary. `flaky` and `quarantined` are statements about the
suite rather than the target, so neither turns a run red.

**A console that says nothing** when the run is green and its known exceptions
are unchanged, and `make selfcheck-loud` to prove the other direction: a stub
target told to carry a defect must exit non-zero and name itself.

**`--changed` now says which half it is missing.** An absent impact map and an
absent checkout to diff are fixed by different people, and one message for both
sent each of them the wrong way.
