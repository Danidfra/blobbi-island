/**
 * Resolves the local player's companion equipment ONCE and publishes it.
 *
 * Mounted near the app root, inside the providers the three underlying queries
 * need (`AppProvider` for the configured relay, `QueryClientProvider` for the
 * queries themselves). Everything below it; every `CurrentBlobbiDisplay` on
 * screen: consumes a plain value and needs neither.
 *
 * The companion is read from the owner profile rather than passed in, because
 * "which Blobbi am I currently playing" is already app-wide state and having
 * two answers to it would let the body and its hat disagree about who is on
 * screen.
 *
 * See `src/contexts/CharacterEquipmentContext.ts` for why this is a context and
 * not a hook called per Blobbi.
 */

import type { ReactNode } from 'react';

import { CharacterEquipmentContext } from '@/contexts/CharacterEquipmentContext';
import { useBlobbonautProfile } from '@/hooks/useBlobbonautProfile';
import { useBlobbis } from '@/hooks/useBlobbis';
import { useCharacterEquipment } from '@/placement/useCharacterEquipment';

export function CharacterEquipmentProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { data: profile } = useBlobbonautProfile();
  const { data: blobbis } = useBlobbis();

  const companionId = profile?.currentCompanion;
  const companion = companionId
    ? blobbis?.find((b) => b.id === companionId)
    : undefined;

  // The form gates form-restricted cosmetics. It is passed only when known:
  // `undefined` means "form unknown", which `formIsCompatible` treats as no
  // restriction rather than as a mismatch, a hat must not vanish because the
  // Blobbi list has not loaded yet.
  const equipment = useCharacterEquipment(companionId, {
    ...(companion?.stage === undefined ? {} : { form: companion.stage }),
  });

  return (
    <CharacterEquipmentContext.Provider value={equipment}>
      {children}
    </CharacterEquipmentContext.Provider>
  );
}
