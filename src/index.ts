/**
 * What a harness built on this kernel may use. The package's public surface is
 * this file: anything not exported here is the kernel's own business.
 */
export * from './kernel/areas.js'
export * from './kernel/artefacts.js'
export * from './kernel/capabilities.js'
export * from './kernel/check.js'
export * from './kernel/circuit.js'
export * from './kernel/failure.js'
export * from './kernel/journal.js'
export * from './kernel/observation.js'
export * from './kernel/preflight.js'
export * from './kernel/probe.js'
export * from './kernel/retry.js'
export * from './kernel/run.js'
export * from './kernel/runner.js'
export * from './kernel/seed.js'
export * from './kernel/selection.js'
export * from './kernel/verdict.js'

export * from './history/drift.js'
export * from './history/flake.js'
export * from './history/measurements.js'
export * from './history/quarantine.js'
export * from './history/signature.js'

export * from './reporting/console-reporter.js'
export * from './reporting/json-reporter.js'
export * from './reporting/matrix-reporter.js'
export * from './reporting/percentile.js'
export * from './reporting/summary.js'

export * from './surfaces/http.js'
export * from './targets/target.js'
export * from './targets/registry.js'
export * from './paths.js'

export * from './cli/harness.js'
export * from './cli/options.js'
export * from './cli/pipeline.js'
export * from './cli/dispatch.js'
