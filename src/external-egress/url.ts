/**
 * What counts as a destination, and what is refused before anything opens.
 *
 * ## One allowed scheme
 *
 * `https:` and nothing else. Every destination the island actually has is
 * HTTPS, so a wider allow-list would be flexibility nobody asked for and a
 * standing invitation:
 *
 *  - `javascript:` executes in this origin. A `javascript:` URL reaching
 *    `window.open` is script injection with extra steps.
 *  - `data:` and `blob:` render attacker-controlled content that the address bar
 *    presents as a page. There is no legitimate case here, the PhotoBooth's
 *    `blob:`/`data:` URLs go to a download link and an `<img>`, never to a
 *    navigation.
 *  - `http:` is a downgrade, and nothing in the product needs it.
 *  - `file:`, `about:`, `chrome:` and friends are browser-internal.
 *  - `wss:` is a RELAY address, not a place to navigate. It is called out
 *    explicitly because relay URLs are the one non-HTTP string the app routinely
 *    handles, and confusing the two is the mistake this module exists to make
 *    impossible.
 *
 * ## Same-origin is not egress
 *
 * A link back into Blobbi Island is internal navigation, and routing it through
 * an "are you sure you want to leave?" dialog would be both wrong and quickly
 * ignored. `classifyDestination` separates the two so a caller cannot
 * accidentally use the external path for a React route.
 *
 * ## The host is the truth
 *
 * Confirmation shows `classifyDestination().host`, parsed from the URL; never a
 * label the caller passed in. A label is presentation; the host is where the
 * player is actually going, and if the two disagree the player must be shown the
 * one that is true.
 */

/** The only scheme this application will navigate to. */
export const ALLOWED_EGRESS_PROTOCOL = 'https:';

export type DestinationRejection =
  | 'empty'
  | 'unparseable'
  | 'forbidden-scheme'
  | 'relay-url'
  | 'no-host';

export type Destination =
  | {
      readonly kind: 'external';
      /** The normalized absolute URL that will be opened. */
      readonly url: string;
      /** The hostname, lowercased and stripped of `www.`: what the player is shown. */
      readonly host: string;
    }
  | { readonly kind: 'internal'; readonly url: string }
  | { readonly kind: 'invalid'; readonly reason: DestinationRejection };

/** `www.` carries no information for a player deciding whether to continue. */
function displayHost(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.startsWith('www.') ? lower.slice(4) : lower;
}

function currentOrigin(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.location.origin;
  } catch {
    return null;
  }
}

/**
 * Decide what a candidate destination is.
 *
 * Never throws: a malformed URL is an ordinary input here, not an exception.
 *
 * @param raw - the candidate, absolute or relative
 * @param origin - the origin to treat as internal; defaults to the page's
 */
export function classifyDestination(raw: string, origin?: string | null): Destination {
  if (typeof raw !== 'string' || raw.trim() === '') return { kind: 'invalid', reason: 'empty' };

  const base = origin === undefined ? currentOrigin() : origin;
  const trimmed = raw.trim();

  let url: URL;
  try {
    // Parsing against the origin is what makes `/settings` resolvable and
    // classifiable as internal, rather than simply unparseable.
    url = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return { kind: 'invalid', reason: 'unparseable' };
  }

  // Called out before the general scheme check so the reason is specific: a
  // relay address reaching a navigation is a category error, not a typo.
  if (url.protocol === 'wss:' || url.protocol === 'ws:') {
    return { kind: 'invalid', reason: 'relay-url' };
  }

  if (url.protocol !== ALLOWED_EGRESS_PROTOCOL) {
    return { kind: 'invalid', reason: 'forbidden-scheme' };
  }

  if (!url.hostname) return { kind: 'invalid', reason: 'no-host' };

  // Same origin means the player is not going anywhere.
  if (base) {
    try {
      if (url.origin === new URL(base).origin) return { kind: 'internal', url: url.toString() };
    } catch {
      /* an unparseable base simply means everything is external */
    }
  }

  return { kind: 'external', url: url.toString(), host: displayHost(url.hostname) };
}

/** Convenience for call sites that only need the yes/no. */
export function isExternalDestination(raw: string, origin?: string | null): boolean {
  return classifyDestination(raw, origin).kind === 'external';
}
