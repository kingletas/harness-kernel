import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { selectFrom, type ImpactRule } from '../../src/kernel/selection.js'

const RULES: readonly ImpactRule[] = [
	{ pattern: /module-catalog/, areas: ['category', 'product'], why: 'the catalogue' },
	{ pattern: /module-checkout/, areas: ['cart', 'checkout'], why: 'the quote' },
	{ pattern: /view\/frontend\//, areas: ['home', 'category'], why: 'templates' },
]

describe('selectFrom', () => {
	it('says nothing is at risk when nothing changed', () => {
		const selection = selectFrom([], RULES)

		assert.deepEqual(selection.areas, [])
		assert.equal(selection.runEverything, false)
	})

	it('collects the areas of every rule a path matches', () => {
		const selection = selectFrom(['vendor/magento/module-catalog/Model/Product.php'], RULES)

		assert.deepEqual(selection.areas, ['category', 'product'])
		assert.equal(selection.runEverything, false)
	})

	it('unions the areas across several changed paths, without repeating one', () => {
		const selection = selectFrom(
			['a/module-catalog/x.php', 'b/module-checkout/y.php', 'c/view/frontend/z.phtml'],
			RULES,
		)

		assert.deepEqual(selection.areas, ['cart', 'category', 'checkout', 'home', 'product'])
	})

	it('runs everything when a changed path matches no rule', () => {
		// An unmapped path means the map is incomplete, not that the change is
		// harmless. Narrowing on an incomplete map is how a run reports full
		// coverage of a subset.
		const selection = selectFrom(['README.md', 'a/module-catalog/x.php'], RULES)

		assert.equal(selection.runEverything, true)
		assert.deepEqual(selection.unmapped, ['README.md'])
		assert.match(selection.reason, /map is incomplete/)
	})

	it('still reports what it did work out, even when falling back', () => {
		// The fallback is about what to run; the areas are still worth printing,
		// because they are the part somebody can act on.
		const selection = selectFrom(['README.md', 'a/module-catalog/x.php'], RULES)

		assert.deepEqual(selection.areas, ['category', 'product'])
	})

	it('always states a reason, whichever way it went', () => {
		for (const changed of [[], ['a/module-catalog/x.php'], ['unknown.txt']]) {
			assert.ok(selectFrom(changed, RULES).reason.length > 0)
		}
	})
})
