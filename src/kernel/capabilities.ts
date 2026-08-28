/**
 * What a target can be asked to do, so a check that cannot run reports
 * `unsupported` rather than being absent from the summary.
 */
export interface Capabilities {
	/** The target has a browser-drivable surface. */
	readonly browser: boolean
	/** Customers can be created and removed by the harness. */
	readonly canProvisionCustomers: boolean
	/** Catalogue, price and promotion data can be created by the harness. */
	readonly canProvisionCatalogue: boolean
	/** A payment outcome can be forced — a sandbox gateway, or nothing. */
	readonly canForcePaymentOutcome: boolean
	/** Data is partitioned per tenant, so runs cannot collide. */
	readonly hasMultiTenancy: boolean
	/** The harness may query the target's database directly. */
	readonly canReadDatabase: boolean
	/** Outbound webhooks can be observed by the harness. */
	readonly canObserveOutboundWebhooks: boolean
	/**
	 * Outbound email can be read back, so a check can prove a message was sent
	 * rather than that a route claimed to send one.
	 */
	readonly canObserveOutboundEmail: boolean
	/** The target may be written to destructively; declared by the environment, never a suite. */
	readonly isDisposable: boolean
}

export type CapabilityName = keyof Capabilities

/** Nothing is available until a target says otherwise. */
export const NO_CAPABILITIES: Capabilities = {
	browser: false,
	canProvisionCustomers: false,
	canProvisionCatalogue: false,
	canForcePaymentOutcome: false,
	hasMultiTenancy: false,
	canReadDatabase: false,
	canObserveOutboundWebhooks: false,
	canObserveOutboundEmail: false,
	isDisposable: false,
}

/** The subset of `needs` this target does not declare. */
export const missingCapabilities = (
	needs: readonly CapabilityName[],
	available: Capabilities,
): readonly CapabilityName[] => needs.filter(name => !available[name])
