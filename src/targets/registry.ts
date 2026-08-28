import type { Target, TargetOptions } from './target.js'

export type TargetFactory = (options: TargetOptions) => Target

/** The targets one harness knows about; each tool builds its own. */
export interface Registry {
	names(): readonly string[]
	named(name: string, options?: TargetOptions): Target
}

/** Builds a registry, naming the targets that exist when asked for one that does not. */
export const registryOf = (factories: Readonly<Record<string, TargetFactory>>): Registry => ({
	names: () => Object.keys(factories).sort(),
	named: (name, options = {}) => {
		const factory = factories[name]
		if (factory === undefined) {
			throw new Error(
				`no target named "${name}" — known targets: ${Object.keys(factories).sort().join(', ')}`,
			)
		}
		return factory(options)
	},
})
