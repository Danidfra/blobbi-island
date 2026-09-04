/**
 * Who is signing, and what that means for this tool.
 *
 * Three states, and the difference between them is the entire access policy:
 *
 *   unauthenticated  no signer → the editor works, publishing does not
 *   official         the signer IS `OFFICIAL_ITEM_ISSUER_PUBKEY`
 *   third-party      a signer, but not that one
 *
 * A third-party signer may publish. Refusing would be theatre: anybody can
 * publish a kind:31632 event with any `d` from any client, and Blobbi Island
 * already defends itself the only way that works, `parseOfficialItemDefinition`
 * rejects every non-official issuer before a definition can reach the catalog.
 * So the honest behavior is to let the event be published under the user's own
 * key and to say plainly, everywhere it matters, that the game will not resolve
 * it. What this tool must never do is let a third-party definition LOOK
 * official, which is why the mode is computed once here and shown on the header,
 * in the review dialog, and on every browser row.
 *
 * No key material is read, derived, or stored anywhere in this module. A pubkey
 * is a public identifier.
 */

import { nip19 } from 'nostr-tools';

import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';

export type IssuerMode = 'unauthenticated' | 'official' | 'third-party';

export interface SignerIdentity {
  mode: IssuerMode;
  pubkey: string | null;
  /** bech32 `npub…`, or `null` when there is no signer or encoding fails. */
  npub: string | null;
  /** Abbreviated hex, for dense UI. */
  shortHex: string | null;
  isOfficialIssuer: boolean;
}

/** Abbreviate a hex identifier as `abcdef…123456`. */
export function shortHex(value: string, lead = 8, tail = 6): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/**
 * Encode a pubkey as an npub, or return `null`.
 *
 * Never throws: a malformed pubkey is a display problem, not a crash, and this
 * runs inside a header that must render for any account state.
 */
export function safeNpub(pubkey: string | null | undefined): string | null {
  if (!pubkey) return null;
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return null;
  }
}

/** Describe the active signer for the tools' access policy. */
export function describeSigner(pubkey: string | null | undefined): SignerIdentity {
  if (!pubkey) {
    return {
      mode: 'unauthenticated',
      pubkey: null,
      npub: null,
      shortHex: null,
      isOfficialIssuer: false,
    };
  }
  const isOfficialIssuer = pubkey === OFFICIAL_ITEM_ISSUER_PUBKEY;
  return {
    mode: isOfficialIssuer ? 'official' : 'third-party',
    pubkey,
    npub: safeNpub(pubkey),
    shortHex: shortHex(pubkey),
    isOfficialIssuer,
  };
}

/**
 * May this signer publish at all?
 *
 * Only the absence of a signer prevents it. See the module note for why a
 * third-party key is allowed rather than blocked.
 */
export function canPublish(identity: SignerIdentity): boolean {
  return identity.mode !== 'unauthenticated';
}

/** Is `pubkey` the official Blobbi item issuer? */
export function isOfficialIssuer(pubkey: string | null | undefined): boolean {
  return !!pubkey && pubkey === OFFICIAL_ITEM_ISSUER_PUBKEY;
}

export { OFFICIAL_ITEM_ISSUER_PUBKEY };
