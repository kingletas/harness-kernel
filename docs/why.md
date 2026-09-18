# Why harness-kernel exists

**Because a harness testing two things that have nothing in common still turns out to be mostly the same harness twice.**

## The problem

This started inside one repository, as the shared half of a test harness driving two targets. The two targets shared almost nothing — different surfaces, different protocols, different notions of what a successful interaction even was.

And yet the two halves kept converging on the same code. Both needed a run with an id and a seed, a build stamped at preflight, checks that could be selected and ordered, latency collected and reported as percentiles, a verdict, an exit code a script could branch on, and evidence a person could read after a failure. None of that is about a storefront, or an API, or anything in particular. It is about **running checks and reporting on them**, and it was being written twice with small gratuitous differences.

The cost of that is not duplication. It is that a fix to the percentile calculation lands on one side, and six weeks later somebody debugs the other side without knowing the answer already exists.

## Why not a general test framework

Because the thing being shared is not assertions. Jest, pytest and their relatives own the shape of a *test file* — describe, it, expect. What was needed is the shape of a **run**: preflight, selection, ordering, timing, the verdict, the exit code, the artefact you read afterwards.

That layer sits above a test framework rather than replacing one, and no framework offers it because it is opinionated about things a general framework must stay neutral on.

## Why extract it rather than share a directory

A shared directory inside one repository has no boundary. Nothing stops a "shared" helper from learning that one of the targets has a shopping cart, and once one does, the shared half is quietly the first target's half with the second one borrowing from it. That erosion is invisible while both consumers live next door.

A package with a published surface makes the boundary checkable, and it makes the rule below enforceable rather than aspirational.

## What the reason decided

**Nothing in here may know what any particular target is.** The registry and the workspace are handed in.

The test for whether something belongs is whether it would still make sense for a target that does not exist yet — a CLI, a queue consumer, a mobile app. **Percentiles belong. Add-to-cart does not.** That single sentence settles almost every question about where a piece of code goes, which is the point of having it.

Two consequences worth naming:

- **The public surface is exactly one file.** Anything not exported from `src/index.ts` is the kernel's own business, and a harness that reaches past it gets a module that does not resolve. The layering is enforced by the module graph rather than by a naming convention somebody has to remember.
- **The install fails when the kernel will not compile.** A prepare script that swallows its own failure hands the consumer a package with no build output and no error, which is a worse outcome than not installing.

## Where the name came from

**The name is descriptive, and there is no story behind it.** It is the kernel of a test harness. Worth saying plainly so nobody goes looking for a meaning that was never there — the interesting naming decision in this line of work is [Slate]'s, not this one.
