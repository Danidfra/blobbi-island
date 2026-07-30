/**
 * Signing and publishing a kind:31632 definition — the one place in the tools
 * that produces a signature.
 *
 * ## Why this does not go through `useNostrPublish`
 *
 * `useNostrPublish` is the right call for gameplay writes and the wrong one
 * here, for two specific reasons:
 *
 *  - it treats a timeout as success ("may have succeeded on some relays") so a
 *    publication that reached nobody reports as published. For a movement event
 *    that is a sensible kindness; for an authoring tool whose entire job is to
 *    tell you what is on the network, it is a lie;
 *  - it publishes through the shared pool, which routes to the single
 *    configured relay. Official item definitions have to land on
 *    `OFFICIAL_ITEM_RELAYS` or the game will not resolve them.
 *
 * So this module fans out with `publishToRelays` and reports every relay's
 * answer individually. It does NOT introduce a second signer: the signature
 * comes from `useCurrentUser().user.signer`, the same account object the rest
 * of the app signs with, and no key material is read, stored, or passed around.
 *
 * ## Nothing here is automatic
 *
 * The mutation is invoked from exactly one place — the explicit "Sign and
 * publish" button inside the review dialog. It is never wired to a form change,
 * a blur, a keyboard shortcut, or the completion of an upload.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { ITEM_CATALOG_QUERY_KEY } from '@/inventory/useItemCatalog';
import { isOfficialItemAddress } from '@/inventory/registry';
import {
  describeError,
  publishToRelays,
  type RelayPublishOutcome,
} from '@/inventory/relay-fan-out';
import {
  KIND_GAME_ITEM_DEFINITION,
  type UnsignedEventTemplate,
} from '@/inventory/package';

import {
  toDefinitionRecord,
  upsertDefinitionRecord,
  useToolRelayUrls,
  type PublishedDefinitionRecord,
} from './useItemDefinitions';

export interface PublishItemDefinitionInput {
  template: UnsignedEventTemplate<typeof KIND_GAME_ITEM_DEFINITION>;
}

export interface PublishItemDefinitionResult {
  /** The signed event, exactly as offered to the relays. */
  event: NostrEvent;
  /** The parsed record, or `null` if the signed event somehow does not parse. */
  record: PublishedDefinitionRecord | null;
  outcomes: RelayPublishOutcome[];
  acceptedRelays: string[];
  rejectedRelays: RelayPublishOutcome[];
  /** True when at least one relay accepted the event. */
  reachedAnyRelay: boolean;
}

/** The client tag the rest of the app stamps on its events. */
const CLIENT_TAG = ['client', 'blobbi'];

/**
 * Sign the template with the active account and offer it to every tool relay.
 *
 * The mutation resolves even when NO relay accepted the event: the caller shows
 * the per-relay table either way, and a form is never cleared on a partial
 * failure. It rejects only when there is no signer or the signer refuses —
 * the two cases where no event exists at all.
 */
export function usePublishItemDefinition() {
  const { user } = useCurrentUser();
  const relayUrls = useToolRelayUrls();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      template,
    }: PublishItemDefinitionInput): Promise<PublishItemDefinitionResult> => {
      if (!user?.signer) {
        throw new Error('No signer is available. Log in before publishing.');
      }

      const tags = template.tags.some(([name]) => name === 'client')
        ? template.tags.map((tag) => [...tag])
        : [...template.tags.map((tag) => [...tag]), [...CLIENT_TAG]];

      let event: NostrEvent;
      try {
        event = await user.signer.signEvent({
          kind: template.kind,
          content: template.content,
          tags,
          created_at: Math.floor(Date.now() / 1000),
        });
      } catch (error) {
        throw new Error(`Signing was rejected: ${describeError(error)}`);
      }

      const outcomes = await publishToRelays(relayUrls, event);
      const acceptedRelays = outcomes.filter((o) => o.ok).map((o) => o.relay);
      const record = toDefinitionRecord(event, acceptedRelays);

      return {
        event,
        record,
        outcomes,
        acceptedRelays,
        rejectedRelays: outcomes.filter((o) => !o.ok),
        reachedAnyRelay: acceptedRelays.length > 0,
      };
    },
    onSuccess: (result) => {
      if (!result.record || !result.reachedAnyRelay) return;

      // Show the published definition immediately, without a refetch.
      upsertDefinitionRecord(queryClient, result.record);

      // A newly published OFFICIAL definition changes what the game itself
      // resolves, so the shared catalog is invalidated too. A third-party
      // definition changes nothing in-game and leaves the catalog alone.
      if (
        result.record.definition.issuer === result.event.pubkey &&
        isOfficialItemAddress(result.record.address)
      ) {
        queryClient.invalidateQueries({ queryKey: ITEM_CATALOG_QUERY_KEY });
      }
    },
  });
}
