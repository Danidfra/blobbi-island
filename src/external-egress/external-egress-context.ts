/**
 * How a feature asks to leave.
 *
 * One function, `requestEgress`, which resolves to whether the player actually
 * went. Awaiting it covers the confirmation round trip, so a caller can close
 * its own modal only once the answer is known — without knowing a dialog was
 * involved.
 */

import { createContext, useContext } from 'react';

import type { EgressRequest } from './egress';

export interface ExternalEgressApi {
  /**
   * Ask to leave. Resolves `true` only if the egress actually happened.
   *
   * `false` covers every other outcome — denied by policy, an invalid
   * destination, a cancelled confirmation, a dismissed share sheet — because
   * from the caller's point of view they are the same thing: nothing happened,
   * and the caller should not act as though it did.
   */
  requestEgress(request: EgressRequest): Promise<boolean>;
}

/**
 * The default refuses everything.
 *
 * A missing provider is a bug, and the safe failure for an egress helper is to
 * not egress. This mirrors the reasoning in `island-safety-context.ts`, with the
 * direction reversed: there, absent context means Standard, because Standard is
 * the shipped product; here it means "no", because opening a window nobody
 * mounted the machinery for is worse than a dead button.
 */
export const ExternalEgressContext = createContext<ExternalEgressApi>({
  requestEgress: async () => false,
});

/** The one call a feature makes to leave Blobbi Island. */
export function useExternalEgress(): ExternalEgressApi {
  return useContext(ExternalEgressContext);
}
