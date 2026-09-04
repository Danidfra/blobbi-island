/**
 * Points the local safety stores at the signed-in account.
 *
 * Renders nothing. It exists because mute, block and report are module-level
 * stores, `isBlocked(pubkey)` is called from the presence ingest and the chat
 * ingest, outside React, on every event, so they cannot read a hook. Something
 * has to tell them whose decisions are in scope, and this is that something.
 *
 * Mounted inside the login provider and above the router, so the answer is set
 * before any world can mount and updated the moment the player switches
 * account. `setSafetyAccount` is idempotent, so a re-render costs nothing.
 *
 * A layout effect rather than an effect: the stores are read during render by
 * components below this one, and a passive effect would leave the first of
 * those renders answering with the PREVIOUS account's list.
 */

import { useLayoutEffect } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { setSafetyAccount } from '@/player-safety';

export function PlayerSafetyAccountSync() {
  const { user } = useCurrentUser();

  useLayoutEffect(() => {
    setSafetyAccount(user?.pubkey ?? null);
  }, [user?.pubkey]);

  return null;
}
