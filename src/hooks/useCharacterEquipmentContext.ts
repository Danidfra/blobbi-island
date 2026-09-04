/**
 * Read the local player's resolved companion equipment (kind:31634).
 *
 * Never throws when no provider is mounted; it returns stable empty equipment,
 * so a Blobbi still renders (bare) in a test, a preview, or any screen that has
 * not been wrapped. See `src/contexts/CharacterEquipmentContext.ts`.
 */

import { useContext } from 'react';

import { CharacterEquipmentContext } from '@/contexts/CharacterEquipmentContext';
import type { CharacterEquipment } from '@/placement/useCharacterEquipment';

export function useCharacterEquipmentContext(): CharacterEquipment {
  return useContext(CharacterEquipmentContext);
}
