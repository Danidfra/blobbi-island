/**
 * External egress: the one boundary for actions that leave Blobbi Island.
 *
 * ```
 *   feature ──▶ requestEgress({ class, … }) ──▶ capability ──▶ URL validation
 *                                                    │
 *                                          confirm ──┴── denied
 *                                             │
 *                                    performEgress ──▶ browser
 * ```
 *
 * A feature names its INTENT and awaits an answer. It does not build a URL, does
 * not read a capability, does not know a dialog exists, and never calls
 * `window.open`. See `docs/external-egress-safety.md`.
 */

export type { EgressClass } from './classes';
export { EGRESS_CAPABILITY, EGRESS_REQUIRES_CONFIRMATION, isEgressAllowed } from './classes';

export type { Destination, DestinationRejection } from './url';
export { ALLOWED_EGRESS_PROTOCOL, classifyDestination, isExternalDestination } from './url';

export type { SharePayload, SocialPlatformId, SocialShareTarget } from './social';
export { SOCIAL_SHARE_TARGETS, isSocialPlatformId, socialShareTarget } from './social';

export type { EgressDecision, EgressDenial, EgressDestination, EgressRequest } from './egress';
export { canNativeShare, decideEgress, performEgress } from './egress';

export type { ExternalEgressApi } from './external-egress-context';
export { ExternalEgressContext, useExternalEgress } from './external-egress-context';
export { ExternalEgressProvider } from './ExternalEgressProvider';
export { EgressRouteGuard } from './EgressRouteGuard';
