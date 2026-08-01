/**
 * The `/dev/equipment` SIMULATION model — pure, local, and publish-free.
 *
 * This is the state behind the dev harness's "what if I owned/equipped X?"
 * controls. It deliberately mirrors the SHAPES of the real protocol state —
 * quantities keyed by full kind:31632 address, placement entries exactly as a
 * kind:31634 document carries them — so the harness can feed the REAL policy
 * and activation resolvers (`selectRenderablePlacements`,
 * `resolveActiveBlobbiEffects`) and the real renderer translation, while the
 * state itself never leaves the component:
 *
 *   - no `useInventoryMutation`, no `useEquipmentMutation`, no signer, no
 *     relay, no query-cache write — a boundary test pins the import graph;
 *   - the real kind:31633/31634 caches are untouched;
 *   - resetting is a plain state replacement.
 *
 * The item universe is the SAME canonical projection the Equipment Lab uses
 * (`LAB_OFFICIAL_ITEMS` — sixteen items derived from the Phase-9 registries),
 * so this module cannot drift into a second hand-maintained list, identity
 * stays the full official address, and simulated quantities respect the
 * published `max_stack` exactly like the live Lab's controls (owned means 1,
 * never more, through any normal control).
 *
 * POLICY DOES NOT LIVE HERE. Equipping stores a plain placement entry
 * (last-wins per slot, unrelated slots preserved — the same collapse the
 * package writer performs); whether an entry actually RENDERS (ownership,
 * issuer, slot, form, stale placements, egg rejection) is decided by the real
 * resolvers at render time. The one policy-adjacent rule this module does
 * enforce is the harness's own equip gate: simulated equip requires simulated
 * ownership unless the explicit stale-placement diagnostic override is on.
 */

import type { GameItemPlacementEntry } from '@/inventory/package';
import {
  LAB_OFFICIAL_ITEMS,
  LAB_TEST_LOADOUT,
  labItemByAddress,
  type LabOfficialItem,
} from '@/tools/game-items/inventory-equipment-lab';
import { officialItemAddress } from '@/protocol/event-registry';

export type DevSimStage = 'egg' | 'baby' | 'adult';

export interface DevSimState {
  /** address → simulated quantity (0 or the item's max stack — 1 today). */
  readonly quantities: ReadonlyMap<string, number>;
  /** The simulated kind:31634 entries, one per occupied slot. */
  readonly placements: readonly GameItemPlacementEntry[];
  readonly stage: DevSimStage;
  /**
   * Diagnostic override: allow equipping items that are not simulated-owned,
   * to CREATE the stale/unowned placements the resolvers must reject. Off by
   * default so the ordinary flow matches production's ownership gate.
   */
  readonly allowUnownedEquip: boolean;
}

/** Deterministic initial state: nothing owned, nothing equipped, adult. */
export const INITIAL_DEV_SIM_STATE: DevSimState = {
  quantities: new Map(),
  placements: [],
  stage: 'adult',
  allowUnownedEquip: false,
};

export type DevSimItemKind = 'wearables' | 'effects' | 'all';

export type DevSimAction =
  | { type: 'set-owned'; address: string; owned: boolean }
  | { type: 'bulk-own'; kind: DevSimItemKind }
  | { type: 'bulk-clear'; kind: DevSimItemKind }
  /** Equip `address` into `slot`, replacing only that slot's occupant. */
  | { type: 'equip'; address: string; slot: string }
  | { type: 'unequip'; slot: string }
  | { type: 'apply-loadout' }
  | { type: 'clear-loadout' }
  | { type: 'set-stage'; stage: DevSimStage }
  | { type: 'set-allow-unowned'; value: boolean }
  | { type: 'reset' };

function itemsOf(kind: DevSimItemKind): readonly LabOfficialItem[] {
  if (kind === 'all') return LAB_OFFICIAL_ITEMS;
  return LAB_OFFICIAL_ITEMS.filter((item) =>
    kind === 'wearables' ? item.kind === 'wearable' : item.kind === 'effect',
  );
}

/** The simulated "owned" quantity for an item: its max stack, capped — 1. */
function ownedQuantity(item: LabOfficialItem): number {
  return Math.max(1, Math.min(1, item.maxStack ?? 1));
}

function equipEntry(address: string, slot: string): GameItemPlacementEntry {
  return { id: slot, item: address, mode: 'equip', slot };
}

/** Replace only `slot`'s occupant, preserving every other placement. */
function withSlot(
  placements: readonly GameItemPlacementEntry[],
  slot: string,
  entry: GameItemPlacementEntry | null,
): readonly GameItemPlacementEntry[] {
  const kept = placements.filter((p) => p.slot !== slot);
  return entry === null ? kept : [...kept, entry];
}

export function devSimReducer(
  state: DevSimState,
  action: DevSimAction,
): DevSimState {
  switch (action.type) {
    case 'set-owned': {
      const item = labItemByAddress(action.address);
      if (!item) return state; // only official registered items exist here
      const quantities = new Map(state.quantities);
      if (action.owned) {
        // Owned means the published max stack — never above it. All sixteen
        // current items cap at one, so no misleading ×N can appear.
        quantities.set(item.address, ownedQuantity(item));
      } else {
        quantities.delete(item.address);
      }
      return { ...state, quantities };
    }

    case 'bulk-own': {
      const quantities = new Map(state.quantities);
      for (const item of itemsOf(action.kind)) {
        quantities.set(item.address, ownedQuantity(item));
      }
      return { ...state, quantities };
    }

    case 'bulk-clear': {
      const quantities = new Map(state.quantities);
      for (const item of itemsOf(action.kind)) {
        quantities.delete(item.address);
      }
      return { ...state, quantities };
    }

    case 'equip': {
      // The harness's ownership gate, mirroring production's: equipping
      // requires the item unless the stale-placement diagnostic is on.
      const owned = (state.quantities.get(action.address) ?? 0) > 0;
      if (!owned && !state.allowUnownedEquip) return state;
      return {
        ...state,
        placements: withSlot(
          state.placements,
          action.slot,
          equipEntry(action.address, action.slot),
        ),
      };
    }

    case 'unequip':
      return {
        ...state,
        placements: withSlot(state.placements, action.slot, null),
      };

    case 'apply-loadout': {
      // The documented seven-slot loadout. Each step obeys the same equip
      // gate; unowned steps are skipped rather than smuggled in — own the
      // items first (bulk-own) or enable the diagnostic override.
      let placements = state.placements;
      for (const { slot, d } of LAB_TEST_LOADOUT) {
        const address = officialItemAddress(d);
        const owned = (state.quantities.get(address) ?? 0) > 0;
        if (!owned && !state.allowUnownedEquip) continue;
        placements = withSlot(placements, slot, equipEntry(address, slot));
      }
      return { ...state, placements };
    }

    case 'clear-loadout':
      return { ...state, placements: [] };

    case 'set-stage':
      return { ...state, stage: action.stage };

    case 'set-allow-unowned':
      return { ...state, allowUnownedEquip: action.value };

    case 'reset':
      return INITIAL_DEV_SIM_STATE;

    default: {
      const exhaustive: never = action;
      throw new Error(`Unknown action ${JSON.stringify(exhaustive)}`);
    }
  }
}
