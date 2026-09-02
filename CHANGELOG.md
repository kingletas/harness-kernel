# Changelog

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
