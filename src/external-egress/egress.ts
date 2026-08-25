/**
 * The chokepoint. **The only module in the application that opens a browser
 * window or invokes the share sheet.**
 *
 * ## Two halves, deliberately separated
 *
 * `decideEgress` is pure: policy plus request in, a decision out. No browser, no
 * clock, no DOM. That is what lets every capability and validation rule be
 * tested without a window, and what stops the decision from drifting into the
 * component that renders the dialog.
 *
 * `performEgress` is the impure half, and it is deliberately tiny: it takes an
 * already-decided request and calls the browser. A structural test asserts that
 * `window.open` and `navigator.share` appear nowhere else in `src/`, so there is
 * no second way out.
 *
 * ## Why the decision refuses before the browser, not after
 *
 * A denied capability must fail *before* `window.open` is reached — not by
 * hiding the button that would have called it. Hiding UI is presentation; a
 * component that still holds the callback is one prop away from being reachable,
 * and a modified build has the callback regardless. `decideEgress` returning
 * `denied` is what makes the restriction real, and the tests assert the browser
 * API was never called rather than that a button was missing.
 */

import type { IslandSafetyPolicy } from '@/safety';

import { EGRESS_REQUIRES_CONFIRMATION, isEgressAllowed, type EgressClass } from './classes';
import { socialShareTarget, type SharePayload, type SocialPlatformId } from './social';
import { classifyDestination, type DestinationRejection } from './url';

/** What a feature asks for. Intent first; the URL is a detail of some classes. */
export type EgressRequest =
  | {
      readonly class: 'external-link';
      readonly url: string;
      /** Optional context for the dialog — never the destination authority. */
      readonly label?: string;
    }
  | {
      readonly class: 'social-share';
      readonly platform: SocialPlatformId;
      readonly payload: SharePayload;
    }
  | {
      readonly class: 'native-share';
      readonly data: ShareData;
    };

/** Every reason a request can be turned down. */
export type EgressDenial =
  /** The current experience does not permit this class. */
  | { readonly reason: 'capability'; readonly egressClass: EgressClass }
  /** The URL was refused by `classifyDestination`. */
  | { readonly reason: 'invalid-destination'; readonly detail: DestinationRejection }
  /** The URL resolved to Blobbi Island itself — internal navigation, not egress. */
  | { readonly reason: 'internal-destination' }
  /** An unknown platform id. */
  | { readonly reason: 'unknown-platform' }
  /** The browser has no Web Share API. */
  | { readonly reason: 'unsupported' };

/** What the confirmation shows. Every field is locally derived. */
export interface EgressDestination {
  readonly egressClass: EgressClass;
  /** The parsed host — `t.me`, `github.com`. The truthful part. */
  readonly host: string;
  /** A trusted local name for the destination, when one exists. */
  readonly label?: string;
  /** The absolute URL that will be opened. */
  readonly url: string;
}

export type EgressDecision =
  | { readonly outcome: 'denied'; readonly denial: EgressDenial }
  /** Allowed, and the player must be asked first. */
  | { readonly outcome: 'confirm'; readonly destination: EgressDestination }
  /** Allowed, and no confirmation applies to this class. */
  | { readonly outcome: 'allowed'; readonly destination: EgressDestination | null };

function denied(denial: EgressDenial): EgressDecision {
  return { outcome: 'denied', denial };
}

/**
 * Resolve a request to a destination, or to the reason it is not one.
 *
 * Order matters. The capability is checked FIRST, before the URL is even
 * parsed: a profile that does not permit social sharing should not be doing work
 * on a share URL, and "denied" must not depend on whether the destination
 * happened to be well-formed.
 */
export function decideEgress(
  policy: IslandSafetyPolicy,
  request: EgressRequest,
  origin?: string | null,
): EgressDecision {
  if (!isEgressAllowed(policy, request.class)) {
    return denied({ reason: 'capability', egressClass: request.class });
  }

  switch (request.class) {
    case 'native-share': {
      // Nothing to validate — the destination is whatever the operating system
      // offers, which is exactly why this class has its own capability.
      if (!canNativeShare(request.data)) return denied({ reason: 'unsupported' });
      return { outcome: 'allowed', destination: null };
    }

    case 'social-share': {
      const target = socialShareTarget(request.platform);
      if (!target) return denied({ reason: 'unknown-platform' });
      return resolve(request.class, target.buildUrl(request.payload), target.label, origin);
    }

    case 'external-link':
      return resolve(request.class, request.url, request.label, origin);
  }
}

function resolve(
  egressClass: EgressClass,
  rawUrl: string,
  label: string | undefined,
  origin?: string | null,
): EgressDecision {
  const destination = classifyDestination(rawUrl, origin);

  if (destination.kind === 'invalid') {
    return denied({ reason: 'invalid-destination', detail: destination.reason });
  }
  if (destination.kind === 'internal') {
    // A caller that reached for the external API to move around inside the
    // island has made a mistake worth surfacing rather than quietly performing.
    return denied({ reason: 'internal-destination' });
  }

  const resolved: EgressDestination = {
    egressClass,
    host: destination.host,
    url: destination.url,
    ...(label ? { label } : {}),
  };

  return EGRESS_REQUIRES_CONFIRMATION[egressClass]
    ? { outcome: 'confirm', destination: resolved }
    : { outcome: 'allowed', destination: resolved };
}

/** Whether this browser can hand `data` to the OS share sheet. */
export function canNativeShare(data: ShareData): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
    // `canShare` is the only way to know a file payload will be accepted; where
    // it is missing, a data-only share is still fine.
    if (data.files?.length) {
      return typeof navigator.canShare === 'function' && navigator.canShare(data);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Actually leave. **The only place the application opens a window or shares.**
 *
 * Takes a request that has already been decided — it does not re-check the
 * policy, because a second check here would suggest the first one was optional.
 * The provider is what guarantees the pairing; the structural test is what
 * guarantees there is no other caller.
 *
 * ## Opener isolation
 *
 * Every window is opened `noopener,noreferrer`. Without `noopener` the opened
 * page gets a live `window.opener` handle to this tab and can navigate it —
 * `target="_blank"` tabnabbing, which the scattered `window.open` calls this
 * module replaces were all vulnerable to. Centralising it means it is now true
 * everywhere by construction rather than in the places somebody remembered.
 *
 * The popup geometry for a social share is preserved from the previous
 * behaviour, so a share window still opens as a compact popup rather than a
 * full tab.
 */
export async function performEgress(request: EgressRequest, url?: string): Promise<boolean> {
  if (request.class === 'native-share') {
    try {
      await navigator.share(request.data);
      return true;
    } catch {
      // A cancelled share sheet rejects. That is the player changing their mind,
      // not a failure worth reporting.
      return false;
    }
  }

  if (!url) return false;

  const features =
    request.class === 'social-share'
      ? 'noopener,noreferrer,width=600,height=400'
      : 'noopener,noreferrer';

  try {
    // With `noopener` the browser returns null by design, so the return value
    // says nothing about success and is deliberately not inspected.
    window.open(url, '_blank', features);
    return true;
  } catch {
    return false;
  }
}
