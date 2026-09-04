/**
 * Read the theme out of Ditto's encrypted app settings (NIP-78 kind:30078).
 *
 * This is the read half of the channel that actually decides which theme Ditto
 * is rendering: see `src/lib/ditto-settings.ts` for why 16767 is not it.
 *
 * ## Why the read is completion-aware and the failure is silent
 *
 * `NPool.query()` cannot fail: a timeout, a dead socket and a genuinely empty
 * relay all return `[]`. For THIS read that difference is the whole story, a
 * false empty would say "you have never chosen a theme anywhere", and the sync
 * that consumes it would have no way to tell that from the truth. So the read
 * throws on an unusable outcome and React Query keeps the last good value.
 *
 * A decrypt failure resolves to `null` rather than throwing: a signer without
 * NIP-44, or a blob written by a key we no longer hold, is a permanent
 * condition, not a transient one, and retrying it forever would be noise.
 */

import { useQuery } from '@tanstack/react-query';

import { useNostr } from '@/hooks/useNostr';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { readRelayEventsOrThrow } from '@/lib/relay-read';
import {
  dittoSettingsFilter,
  newestSettingsEvent,
  parseDittoThemeSettings,
  type DittoThemeSettings,
} from '@/lib/ditto-settings';

const READ_TIMEOUT_MS = 4000;

export interface DittoThemeSettingsResult {
  settings: DittoThemeSettings | null;
  /** `created_at` of the settings event, for ordering against other channels. */
  createdAt: number | null;
}

export function useDittoThemeSettings() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const pubkey = user?.pubkey;
  const canDecrypt = !!user?.signer?.nip44;

  return useQuery<DittoThemeSettingsResult>({
    queryKey: ['ditto-theme-settings', pubkey ?? ''],
    queryFn: async (c) => {
      if (!pubkey || !user?.signer?.nip44) return { settings: null, createdAt: null };

      const events = await readRelayEventsOrThrow(nostr, [dittoSettingsFilter(pubkey)], {
        signal: c.signal,
        timeoutMs: READ_TIMEOUT_MS,
      });

      const event = newestSettingsEvent(events);
      if (!event) return { settings: null, createdAt: null };

      let decrypted: string;
      try {
        decrypted = await user.signer.nip44.decrypt(pubkey, event.content);
      } catch {
        return { settings: null, createdAt: event.created_at };
      }

      return { settings: parseDittoThemeSettings(decrypted), createdAt: event.created_at };
    },
    // Needs a signer that can decrypt; without one there is nothing to read.
    enabled: !!pubkey && canDecrypt,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });
}
