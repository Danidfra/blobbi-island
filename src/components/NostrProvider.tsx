import React, { useEffect, useRef } from 'react';
import { NostrContext } from '@nostrify/react';
import { useNostrLogin } from '@nostrify/react/login';
import { useQueryClient } from '@tanstack/react-query';
import { useAppContext } from '@/hooks/useAppContext';
import { IslandRelayPool } from '@/relays/island-relay-pool';
import { relaySelection } from '@/relays/relay-config';
import type { IslandRelayConfig } from '@/relays/island-flows';

interface NostrProviderProps {
  children: React.ReactNode;
}

/**
 * The app's one relay pool.
 *
 * Every hook reads and writes through it, and it decides where: the primary
 * relay plus the secondaries, per flow, with merged reads and per-relay
 * publish results. See `src/relays/island-relay-pool.ts`.
 */
const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;
  const { config } = useAppContext();
  const { logins } = useNostrLogin();

  const queryClient = useQueryClient();

  // Create the pool only once
  const pool = useRef<IslandRelayPool | undefined>(undefined);

  // Refs so the pool always routes by the latest selection and account
  const selection = relaySelection(config);
  const selectionKey = [selection.primary, ...selection.secondaries].join('\n');
  const relays = useRef<IslandRelayConfig>(selection);
  const pubkey = useRef<string | null>(logins[0]?.pubkey ?? null);
  relays.current = selection;
  pubkey.current = logins[0]?.pubkey ?? null;

  // A different relay selection is a different view of the world: read again
  useEffect(() => {
    queryClient.resetQueries();
  }, [selectionKey, queryClient]);

  if (!pool.current) {
    pool.current = new IslandRelayPool({
      getConfig: () => relays.current,
      getPubkey: () => pubkey.current,
    });
  }

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      {children}
    </NostrContext.Provider>
  );
};

export default NostrProvider;
