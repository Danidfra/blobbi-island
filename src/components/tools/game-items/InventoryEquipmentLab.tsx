/**
 * Inventory & Equipment Lab, internal developer tool for REAL kind:31633 and
 * kind:31634 mutations against the CURRENT account.
 *
 * ## Access policy (see docs/inventory-equipment-lab.md)
 *
 * BUILD-FLAG GATED: this component exists in a build only when
 * `VITE_ENABLE_LIVE_INVENTORY_LAB=true` (`src/lib/feature-flags.ts`); default
 * builds do not include its chunk, its tab, or any of its mutation hooks. The
 * flag: not route obscurity, not the signer, is the product access gate.
 * Within an enabled build, every write still requires an explicit
 * confirmation and a signature from the logged-in account, and can only ever
 * touch THAT account's own inventory and its own Blobbi's equipment document.
 * Without a signer every write control is disabled.
 *
 * The three roles stay visibly apart: the official ISSUER authored the
 * kind:31632 definitions (shown as the trust root); the PLAYER, the signer,
 * owns kind:31633 and equips through kind:31634. This lab acts only as the
 * player.
 *
 * ## Every write is confirmed, and max_stack is respected
 *
 * EVERY real write, single-item add/remove/set, equip/unequip, stale
 * cleanup, bulk actions, the loadout, the stack repair, flows through ONE
 * confirmation surface ({@link PendingWrite}); `confirmPending` below is the
 * only code path in this component that invokes a writer, and a source test
 * pins that. Normal controls never plan a quantity above the item's published
 * `max_stack` (all sixteen current items: 1): "Add to inventory" means
 * `0 → 1` and is disabled once owned, bulk add ENSURES ownership rather than
 * incrementing, and a pre-existing over-max quantity is reported as an
 * anomaly for the explicit "Normalize stacks" repair; never silently
 * changed. There is deliberately NO control that can create an over-max
 * quantity.
 *
 * Both writers are the canonical production ones (`useInventoryMutation`,
 * `useEquipmentMutation`): serialized, fresh-read based, optimistic with
 * rollback, reconciled after publish. Inventory writes never equip; equipping
 * never grants; removing an owned item never silently edits the placement
 * document (a stale placement stays, diagnosed, with its own explicit remove
 * action).
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  FlaskConical,
  Loader2,
  Minus,
  Plus,
  Shirt,
  Trash2,
  Wand2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCurrentPet } from '@/hooks/useOptimizedStatus';

import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';
import { isAmbiguousInventoryPublish } from '@/inventory/inventory-transaction';
import { useIslandInventory } from '@/inventory/useIslandInventory';
import {
  useInventoryMutation,
  type InventoryMutation,
} from '@/inventory/useInventoryMutation';
import { useItemCatalog } from '@/inventory/useItemCatalog';
import { getInventoryItems } from '@/inventory/package';
import { primaryItemImageUrl } from '@/inventory/item-image-resolution';

import { usePlacementState } from '@/placement/usePlacementState';
import {
  useEquipmentMutation,
  type EquipmentMutation,
} from '@/placement/useEquipmentMutation';
import { useCharacterEquipment } from '@/placement/useCharacterEquipment';
import { isEffectPlacementSlot } from '@/placement/policy';
import type { GameItemPlacementEntry } from '@/inventory/package';

import {
  LAB_OFFICIAL_ITEMS,
  labItemByAddress,
  planBulkInventoryAction,
  planMissingLoadoutItems,
  planTestLoadout,
  type LabBulkInventoryAction,
  type LabInventoryChange,
  type LabLoadoutPlan,
  type LabOfficialItem,
  type LabStackAnomaly,
} from '@/tools/game-items/inventory-equipment-lab';
import { safeNpub, shortHex } from '@/tools/game-items/signer-identity';
import { CopyButton } from './RawEventInspector';

const BULK_ACTION_LABELS: Record<LabBulkInventoryAction, string> = {
  'add-all-wearables': 'Add all official wearables',
  'remove-all-wearables': 'Remove all official wearables',
  'add-all-effects': 'Add all official visual effects',
  'remove-all-effects': 'Remove all official visual effects',
  'add-all-official': 'Add all sixteen published items',
  'remove-all-official': 'Remove all sixteen published items',
  'normalize-stacks': 'Normalize official non-stackable quantities',
};

/**
 * A write awaiting explicit confirmation. EVERY real kind:31633/31634 write
 * this component can make is expressed as one of these first; nothing signs
 * until `confirmPending` runs. `lines` is the complete consequence statement
 * shown in the dialog (kind, target, item, quantity/slot change, and what is
 * deliberately NOT touched).
 */
type PendingWrite =
  | {
      kind: 'inventory';
      title: string;
      lines: readonly string[];
      /** Bulk from→to table, when the write came from a bulk plan. */
      diff?: readonly LabInventoryChange[];
      /** Over-max quantities the plan deliberately left alone. */
      anomalies?: readonly LabStackAnomaly[];
      mutation: InventoryMutation;
      success: string;
    }
  | {
      kind: 'equipment';
      title: string;
      lines: readonly string[];
      mutation: EquipmentMutation;
      success: string;
    }
  | { kind: 'loadout'; plan: LabLoadoutPlan };

export function InventoryEquipmentLab() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const currentPet = useCurrentPet();

  const inventoryQuery = useIslandInventory();
  const catalogQuery = useItemCatalog();
  const inventoryMutation = useInventoryMutation();
  const equipmentMutation = useEquipmentMutation();

  const characterId = currentPet?.id;
  const characterName = currentPet?.name;
  const equipment = useCharacterEquipment(characterId, {
    ...(currentPet?.stage === undefined ? {} : { form: currentPet.stage }),
  });
  const placementQuery = usePlacementState(characterId);

  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});

  const signedIn = Boolean(user?.pubkey);
  const busy = inventoryMutation.isPending || equipmentMutation.isPending;
  const writesDisabled = !signedIn || busy;

  const ownerShort = user?.pubkey ? shortHex(user.pubkey) : 'no signer';
  const blobbiLabel = characterName ?? characterId ?? 'no companion';

  const inventory = inventoryQuery.data;
  const quantities = useMemo(
    () =>
      new Map<string, number>(
        inventory
          ? getInventoryItems(inventory).map((i) => [i.address, i.quantity])
          : [],
      ),
    [inventory],
  );

  const placementDoc = placementQuery.data?.placement;
  /** slot → last equipped entry, straight from the parsed document. */
  const equippedBySlot = useMemo(() => {
    const map = new Map<string, GameItemPlacementEntry>();
    for (const entry of placementDoc?.placements ?? []) {
      if (entry.mode === 'equip' && entry.slot !== undefined) {
        map.set(entry.slot, entry);
      }
    }
    return map;
  }, [placementDoc]);
  const equippedAddresses = useMemo(
    () => new Set([...equippedBySlot.values()].map((e) => e.item)),
    [equippedBySlot],
  );

  // ── THE one writer call-site ─────────────────────────────────────────────
  //
  // Both `mutateAsync` invocations in this component live inside this handler
  // and nowhere else (pinned by a source-level test). Success closes the
  // dialog; failure keeps it open with the state it described still true,
  // rollback already restored the caches. While a publish is in flight both
  // dialog buttons and every row control are disabled, and Cancel is
  // unavailable rather than pretending an in-flight signature can be recalled.

  const confirmPending = async () => {
    if (!pending || busy) return;
    const write = pending;
    try {
      if (write.kind === 'inventory') {
        await inventoryMutation.mutateAsync(write.mutation);
        toast({ title: write.success });
      } else if (write.kind === 'equipment' || write.kind === 'loadout') {
        if (!characterId) throw new Error('No target Blobbi selected');
        const mutation: EquipmentMutation =
          write.kind === 'equipment'
            ? write.mutation
            : { type: 'apply-set', equips: [...write.plan.equips], unequips: [] };
        await equipmentMutation.mutateAsync({
          characterId,
          ...(characterName === undefined ? {} : { characterName }),
          mutation,
        });
        toast({
          title: write.kind === 'equipment' ? write.success : 'Test loadout, published',
        });
      }
      setPending(null);
    } catch (error) {
      // An ambiguous inventory publish MAY have landed, say so instead of
      // claiming nothing was published. The caches re-read the authoritative
      // state either way.
      toast(
        isAmbiguousInventoryPublish(error)
          ? {
              title: 'Write not confirmed; it may or may not have landed',
              description:
                'The relay gave no verdict in time; the inventory will reconcile from the authoritative state.',
              variant: 'destructive',
            }
          : {
              title: 'Write failed: nothing further was published',
              description:
                error instanceof Error ? error.message : 'Publish failed.',
              variant: 'destructive',
            },
      );
    }
  };

  // ── Row-level actions: each one only STAGES a confirmed write ───────────

  const stageAddOne = (item: LabOfficialItem, from: number) => {
    setPending({
      kind: 'inventory',
      title: `Add ${item.name} to inventory`,
      lines: [
        'This will publish a signed kind:31633 event.',
        `Target account: ${ownerShort}`,
        `Item: ${item.name}`,
        `Address: ${item.address}`,
        `Quantity: ${from} → ${from + 1}`,
        'No equipment placement will be changed.',
      ],
      mutation: { type: 'add', address: item.address, amount: 1 },
      success: `${item.name} added`,
    });
  };

  const stageRemoveOne = (item: LabOfficialItem, from: number) => {
    setPending({
      kind: 'inventory',
      title: `Remove one ${item.name}`,
      lines: [
        'This will publish a signed kind:31633 event.',
        `Target account: ${ownerShort}`,
        `Item: ${item.name}`,
        `Address: ${item.address}`,
        `Quantity: ${from} → ${from - 1}`,
        'No equipment placement will be changed.',
      ],
      mutation: { type: 'remove', address: item.address, amount: 1 },
      success: `${item.name} −1`,
    });
  };

  const stageSetQuantity = (item: LabOfficialItem, from: number, to: number) => {
    setPending({
      kind: 'inventory',
      title: `Set ${item.name} to ${to}`,
      lines: [
        'This will publish a signed kind:31633 event.',
        `Target account: ${ownerShort}`,
        `Item: ${item.name}`,
        `Address: ${item.address}`,
        `Quantity: ${from} → ${to}`,
        'Every other inventory entry is preserved.',
        'No equipment placement will be changed.',
      ],
      mutation: { type: 'set', address: item.address, quantity: to },
      success: `${item.name} set to ${to}`,
    });
  };

  const stageRemoveCompletely = (item: LabOfficialItem, from: number) => {
    setPending({
      kind: 'inventory',
      title: `Remove ${item.name} completely`,
      lines: [
        'This will publish a signed kind:31633 event.',
        `Target account: ${ownerShort}`,
        `Item: ${item.name}`,
        `Address: ${item.address}`,
        `Quantity: ${from} → 0 (the entry is omitted, as the protocol specifies)`,
        'Any equipped placement of it becomes STALE and stays in the equipment document until you remove it explicitly.',
      ],
      mutation: { type: 'set', address: item.address, quantity: 0 },
      success: `${item.name} removed`,
    });
  };

  const stageBulkInventory = (action: LabBulkInventoryAction) => {
    const plan = planBulkInventoryAction(action, quantities);
    if (plan.changes.length === 0) {
      toast({
        title:
          plan.anomalies.length > 0
            ? 'Nothing to change; only over-max anomalies (use Normalize)'
            : 'Nothing would change',
      });
      return;
    }
    setPending({
      kind: 'inventory',
      title: BULK_ACTION_LABELS[action],
      lines: [
        'This will publish ONE signed kind:31633 event.',
        `Target account: ${ownerShort}`,
        action.startsWith('add-')
          ? 'Add means ENSURE OWNED (0 → 1); owned items are untouched.'
          : action === 'normalize-stacks'
            ? 'Quantities above the published max_stack are set back to it.'
            : 'Targeted quantities are set to 0.',
        'Unrelated inventory entries are preserved.',
        'No equipment placement will be changed.',
      ],
      diff: plan.changes,
      anomalies: plan.anomalies,
      mutation: { type: 'set-many', targets: [...plan.targets] },
      success: `${BULK_ACTION_LABELS[action]}: published`,
    });
  };

  const stageEquip = (item: LabOfficialItem) => {
    const definition = catalogQuery.data?.byAddress.get(item.address);
    const slot = item.kind === 'effect' ? item.expectedSlot : definition?.slot;
    if (!slot) {
      toast({
        title: 'Cannot equip',
        description:
          'The published definition has not resolved, so the slot is unknown.',
        variant: 'destructive',
      });
      return;
    }
    const occupant = equippedBySlot.get(slot);
    const replaces =
      occupant && occupant.item !== item.address
        ? (labItemByAddress(occupant.item)?.name ?? occupant.item)
        : null;
    setPending({
      kind: 'equipment',
      title: replaces ? `Replace ${replaces} with ${item.name}` : `Equip ${item.name}`,
      lines: [
        `This will publish a signed kind:31634 event for Blobbi “${blobbiLabel}”.`,
        `Slot: ${slot}`,
        replaces ? `Replaces: ${replaces}` : 'The slot is currently empty.',
        `Item: ${item.name}`,
        `Address: ${item.address}`,
        'Inventory quantity will not change.',
        'Unrelated placements are preserved.',
      ],
      mutation: {
        type: 'equip',
        slot,
        entry: { id: slot, item: item.address, mode: 'equip', slot },
      },
      success: `${item.name} equipped`,
    });
  };

  const stageUnequipSlot = (slot: string, stale: boolean) => {
    const entry = equippedBySlot.get(slot);
    const name = entry ? (labItemByAddress(entry.item)?.name ?? entry.item) : slot;
    setPending({
      kind: 'equipment',
      title: stale ? `Remove stale placement: ${name}` : `Unequip ${name}`,
      lines: [
        `This will publish a signed kind:31634 event for Blobbi “${blobbiLabel}”.`,
        `Slot removed: ${slot}`,
        stale
          ? 'The placement is stale (the item is no longer in the inventory); removing it changes no quantity.'
          : 'The item remains in inventory.',
        'Unrelated placements are preserved.',
      ],
      mutation: { type: 'unequip', slot },
      success: stale ? 'Stale placement removed' : `${slot} cleared`,
    });
  };

  const stageUnequipAddress = (address: string) => {
    const slot = [...equippedBySlot.entries()].find(
      ([, entry]) => entry.item === address,
    )?.[0];
    if (slot === undefined) return;
    stageUnequipSlot(slot, (quantities.get(address) ?? 0) <= 0);
  };

  const stageUnequipAllOfKind = (kind: 'wearable' | 'effect') => {
    const slots = [...equippedBySlot.keys()].filter((slot) =>
      kind === 'effect' ? isEffectPlacementSlot(slot) : !isEffectPlacementSlot(slot),
    );
    if (slots.length === 0) {
      toast({ title: 'Nothing to unequip' });
      return;
    }
    setPending({
      kind: 'equipment',
      title: kind === 'effect' ? 'Unequip all effects' : 'Unequip all wearables',
      lines: [
        `This will publish ONE signed kind:31634 event for Blobbi “${blobbiLabel}”.`,
        `Slots removed: ${slots.join(', ')}`,
        'Every item remains in inventory.',
        'Unrelated placements are preserved.',
      ],
      mutation: { type: 'apply-set', equips: [], unequips: slots },
      success: 'Unequipped',
    });
  };

  const stalePlacements = useMemo(
    () =>
      [...equippedBySlot.entries()].filter(
        ([, entry]) => (quantities.get(entry.item) ?? 0) <= 0,
      ),
    [equippedBySlot, quantities],
  );

  const stageClearStalePlacements = () => {
    if (stalePlacements.length === 0) {
      toast({ title: 'No stale placements' });
      return;
    }
    setPending({
      kind: 'equipment',
      title: 'Clear stale placements',
      lines: [
        `This will publish ONE signed kind:31634 event for Blobbi “${blobbiLabel}”.`,
        `Slots removed: ${stalePlacements
          .map(([slot, entry]) => `${slot} (${labItemByAddress(entry.item)?.name ?? entry.item})`)
          .join(', ')}`,
        'Only slots whose item is no longer in the inventory are touched.',
        'No inventory quantity changes.',
      ],
      mutation: {
        type: 'apply-set',
        equips: [],
        unequips: stalePlacements.map(([slot]) => slot),
      },
      success: 'Stale placements cleared',
    });
  };

  const loadoutPlan = useMemo(
    () => planTestLoadout(equippedBySlot, quantities),
    [equippedBySlot, quantities],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  const npub = safeNpub(user?.pubkey);

  return (
    <div className="space-y-4" data-testid="inventory-equipment-lab">
      {/* ── Identity, roles and the live-mutation warning ── */}
      <section className="rounded-lg border border-amber-400/50 bg-amber-50/40 p-3 text-xs dark:border-amber-700/50 dark:bg-amber-950/20">
        <p className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-200">
          <FlaskConical className="h-3.5 w-3.5" />
          Internal developer lab: every action here publishes REAL signed
          events, each behind its own confirmation. This surface exists only in
          builds with VITE_ENABLE_LIVE_INVENTORY_LAB=true.
        </p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Official item issuer (31632)</dt>
          <dd className="font-mono" data-testid="lab-issuer">
            {shortHex(OFFICIAL_ITEM_ISSUER_PUBKEY)}: trust root; this lab never
            writes as the issuer
          </dd>
          <dt className="text-muted-foreground">Inventory owner (31633)</dt>
          <dd className="font-mono" data-testid="lab-owner">
            {signedIn ? (
              <>
                {npub ? `${shortHex(npub, 12, 6)} · ` : ''}
                {shortHex(user!.pubkey)} (you: the signer)
              </>
            ) : (
              'no signer'
            )}
          </dd>
          <dt className="text-muted-foreground">Equipment target (31634)</dt>
          <dd data-testid="lab-target-blobbi">
            {characterId
              ? `${characterName ?? characterId} · ${characterId} · ${currentPet?.stage ?? 'unknown stage'}`
              : 'no current companion selected'}
          </dd>
        </dl>
        {!signedIn && (
          <p
            role="status"
            data-testid="lab-signer-required"
            className="mt-2 font-bold text-destructive"
          >
            Log in to enable writes. Everything below is read-only without a
            signer; nothing is ever signed automatically.
          </p>
        )}
      </section>

      {/* ── Bulk inventory actions ── */}
      <section>
        <h3 className="mb-1.5 text-sm font-bold">Bulk inventory (kind:31633)</h3>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(BULK_ACTION_LABELS) as LabBulkInventoryAction[]).map(
            (action) => (
              <Button
                key={action}
                variant="outline"
                size="sm"
                disabled={writesDisabled}
                data-testid={`lab-bulk-${action}`}
                onClick={() => stageBulkInventory(action)}
              >
                {BULK_ACTION_LABELS[action]}
              </Button>
            ),
          )}
        </div>
      </section>

      {/* ── The sixteen official items ── */}
      {(['wearable', 'effect'] as const).map((kind) => (
        <section key={kind}>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-bold">
            {kind === 'wearable' ? (
              <Shirt className="h-4 w-4" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            {kind === 'wearable' ? 'Official wearables' : 'Official visual effects'}
          </h3>
          <ul className="space-y-1.5">
            {LAB_OFFICIAL_ITEMS.filter((item) => item.kind === kind).map((item) => {
              const quantity = quantities.get(item.address) ?? 0;
              const definition = catalogQuery.data?.byAddress.get(item.address);
              return (
                <LabItemRow
                  key={item.address}
                  item={item}
                  quantity={quantity}
                  equipped={equippedAddresses.has(item.address)}
                  stale={equippedAddresses.has(item.address) && quantity <= 0}
                  definitionImage={definition ? primaryItemImageUrl(definition) : undefined}
                  definitionRarity={definition?.rarity ?? item.rarity}
                  definitionSlot={
                    item.kind === 'effect'
                      ? item.expectedSlot
                      : (definition?.slot ?? null)
                  }
                  definitionCategory={definition?.category}
                  inventoryJson={
                    inventory
                      ? JSON.stringify(getInventoryItems(inventory), null, 2)
                      : ''
                  }
                  definitionJson={JSON.stringify(definition ?? null, null, 2)}
                  writesDisabled={writesDisabled}
                  quantityDraft={quantityDrafts[item.address] ?? ''}
                  onQuantityDraft={(value) =>
                    setQuantityDrafts((prev) => ({ ...prev, [item.address]: value }))
                  }
                  onAddOne={() => stageAddOne(item, quantity)}
                  onRemoveOne={() => stageRemoveOne(item, quantity)}
                  onSetQuantity={(to) => stageSetQuantity(item, quantity, to)}
                  onRemoveCompletely={() => stageRemoveCompletely(item, quantity)}
                  onEquip={() => stageEquip(item)}
                  onUnequip={() => stageUnequipAddress(item.address)}
                />
              );
            })}
          </ul>
        </section>
      ))}

      {/* ── Equipment document ── */}
      <section>
        <h3 className="mb-1.5 text-sm font-bold">
          Equipment document (kind:31634)
        </h3>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={writesDisabled || !characterId}
            data-testid="lab-unequip-all-effects"
            onClick={() => stageUnequipAllOfKind('effect')}
          >
            Unequip all effects
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={writesDisabled || !characterId}
            data-testid="lab-unequip-all-wearables"
            onClick={() => stageUnequipAllOfKind('wearable')}
          >
            Unequip all wearables
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={writesDisabled || !characterId}
            data-testid="lab-clear-stale"
            onClick={stageClearStalePlacements}
          >
            Clear stale placements ({stalePlacements.length})
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={writesDisabled || !characterId || loadoutPlan.isNoop}
            data-testid="lab-apply-loadout"
            onClick={() => setPending({ kind: 'loadout', plan: loadoutPlan })}
          >
            Apply full test loadout
          </Button>
        </div>

        {placementDoc && placementDoc.placements.length > 0 ? (
          <ul className="space-y-1">
            {[...equippedBySlot.entries()].map(([slot, entry]) => {
              const item = labItemByAddress(entry.item);
              const owned = (quantities.get(entry.item) ?? 0) > 0;
              const hiddenReason =
                equipment.hidden.find((h) => h.entry === entry)?.reason ??
                equipment.rejectedEffects.find((r) => r.entry === entry)?.reason;
              return (
                <li
                  key={slot}
                  data-testid={`lab-placement-${slot}`}
                  className="rounded-md border p-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold">{slot}</span>
                    <span>{item?.name ?? entry.item}</span>
                    <Badge variant="outline" className="text-[9px]">
                      {entry.mode}
                    </Badge>
                    {entry.form && (
                      <Badge variant="outline" className="text-[9px]">
                        form: {entry.form}
                      </Badge>
                    )}
                    {!owned && (
                      <Badge variant="destructive" className="text-[9px]">
                        stale: not owned
                      </Badge>
                    )}
                    {owned && !hiddenReason && (
                      <Badge variant="secondary" className="text-[9px]">
                        valid
                      </Badge>
                    )}
                    {hiddenReason && owned && (
                      <Badge variant="destructive" className="text-[9px]">
                        rejected: {hiddenReason}
                      </Badge>
                    )}
                    <span className="ml-auto flex gap-1">
                      <CopyButton value={entry.item} label="Copy address" />
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={writesDisabled}
                        data-testid={`lab-unequip-${slot}`}
                        onClick={() => stageUnequipSlot(slot, !owned)}
                      >
                        {owned ? 'Unequip' : 'Remove stale placement'}
                      </Button>
                    </span>
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground">
                      Raw placement entry
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-muted p-1.5 text-[10px]">
                      {JSON.stringify(entry, null, 2)}
                    </pre>
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
            {characterId
              ? 'This Blobbi has no equipment document entries yet.'
              : 'Select a companion Blobbi in the game to target its equipment.'}
          </p>
        )}

        {placementDoc && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Parsed placement document (d, target, revision, all entries)
            </summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted p-1.5 text-[10px]">
              {JSON.stringify(placementDoc, null, 2)}
            </pre>
          </details>
        )}
      </section>

      {/* ── THE confirmation dialog: complete consequences, then a signature ── */}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          // While a publish is in flight the dialog cannot be dismissed,
          // an in-flight signature cannot honestly be "cancelled".
          if (!open && !busy) setPending(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === 'loadout'
                ? 'Apply the full test loadout'
                : pending?.title}
            </DialogTitle>
            <DialogDescription data-testid="lab-confirm-kind">
              {pending?.kind === 'inventory'
                ? 'This will publish a signed kind:31633 event.'
                : 'This will publish a signed kind:31634 event.'}
            </DialogDescription>
          </DialogHeader>

          {(pending?.kind === 'inventory' || pending?.kind === 'equipment') && (
            <ul data-testid="lab-confirm-lines" className="space-y-0.5 text-xs">
              {pending.lines.map((line) => (
                <li key={line} className="break-all">
                  {line}
                </li>
              ))}
            </ul>
          )}

          {pending?.kind === 'inventory' && pending.diff && (
            <ul
              data-testid="lab-confirm-diff"
              className="max-h-56 space-y-0.5 overflow-y-auto text-xs"
            >
              {pending.diff.map((change) => (
                <li key={change.address} className="flex justify-between gap-2">
                  <span>{change.name}</span>
                  <span className="font-mono">
                    {change.from} → {change.to}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {pending?.kind === 'inventory' &&
            pending.anomalies &&
            pending.anomalies.length > 0 && (
              <div
                data-testid="lab-confirm-anomalies"
                className="rounded-md border border-amber-400/50 bg-amber-50/50 p-2 text-xs dark:border-amber-800/50 dark:bg-amber-950/30"
              >
                <p className="font-bold">Left unchanged (already owned):</p>
                <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                  {pending.anomalies.map((a) => (
                    <li key={a.address}>
                      {a.name} ×{a.quantity}: quantity exceeds published
                      max_stack:{a.maxStack}. Use “{BULK_ACTION_LABELS['normalize-stacks']}”
                      to repair it.
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {pending?.kind === 'loadout' && (
            <div className="space-y-2 text-xs">
              <p>
                This will publish ONE signed kind:31634 event for Blobbi
                “{blobbiLabel}”. Inventory quantities are not modified.
              </p>
              <ul data-testid="lab-loadout-steps" className="space-y-0.5">
                {pending.plan.steps.map((step) => (
                  <li key={step.slot} className="flex justify-between gap-2">
                    <span>
                      {step.slot} → {step.name}
                    </span>
                    <span className="text-muted-foreground">
                      {step.alreadyEquipped
                        ? 'already equipped'
                        : step.replaces
                          ? `replaces ${step.replaces}`
                          : 'empty slot'}
                    </span>
                  </li>
                ))}
              </ul>
              {pending.plan.missing.length > 0 && (
                <div
                  data-testid="lab-loadout-missing"
                  className="rounded-md border border-destructive/40 bg-destructive/10 p-2"
                >
                  <p className="flex items-center gap-1 font-bold text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    Not owned: {pending.plan.missing.map((m) => m.name).join(', ')}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Equipping requires ownership, so the publish would fail. Add
                    the missing items first; that is a SEPARATE kind:31633
                    write with its own confirmation.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1.5"
                    data-testid="lab-loadout-add-missing"
                    onClick={() =>
                      setPending({
                        kind: 'inventory',
                        title: 'Add required loadout items',
                        lines: [
                          'This will publish ONE signed kind:31633 event.',
                          `Target account: ${ownerShort}`,
                          `Sets quantity 1 for: ${pending.plan.missing
                            .map((m) => m.name)
                            .join(', ')}.`,
                          'Nothing is equipped by this write.',
                        ],
                        mutation: {
                          type: 'set-many',
                          targets: [...planMissingLoadoutItems(pending.plan)],
                        },
                        success: 'Required loadout items added',
                      })
                    }
                  >
                    Add required items to inventory first
                  </Button>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              disabled={busy}
              data-testid="lab-confirm-cancel"
              onClick={() => setPending(null)}
            >
              Cancel
            </Button>
            <Button
              data-testid="lab-confirm-publish"
              disabled={
                busy ||
                (pending?.kind === 'loadout' && pending.plan.missing.length > 0)
              }
              onClick={() => void confirmPending()}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Publishing…
                </>
              ) : (
                'Sign and publish'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── One official item row ───────────────────────────────────────────────────

function LabItemRow({
  item,
  quantity,
  equipped,
  stale,
  definitionImage,
  definitionRarity,
  definitionSlot,
  definitionCategory,
  definitionJson,
  inventoryJson,
  writesDisabled,
  quantityDraft,
  onQuantityDraft,
  onAddOne,
  onRemoveOne,
  onSetQuantity,
  onRemoveCompletely,
  onEquip,
  onUnequip,
}: {
  item: LabOfficialItem;
  quantity: number;
  equipped: boolean;
  stale: boolean;
  definitionImage: string | undefined;
  definitionRarity: string | undefined;
  definitionSlot: string | null;
  definitionCategory: string | undefined;
  definitionJson: string;
  inventoryJson: string;
  writesDisabled: boolean;
  quantityDraft: string;
  onQuantityDraft: (value: string) => void;
  onAddOne: () => void;
  onRemoveOne: () => void;
  onSetQuantity: (quantity: number) => void;
  onRemoveCompletely: () => void;
  onEquip: () => void;
  onUnequip: () => void;
}) {
  const image = definitionImage ?? item.image ?? undefined;
  // "Add to inventory" honours the published max_stack: for the current
  // sixteen (all max_stack:1) it means 0 → 1 and is disabled once owned.
  // The set-quantity input is bounded the same way; no ordinary control can
  // create an over-max quantity, and no advanced override exists.
  const atOrAboveMax = item.maxStack !== null && quantity >= item.maxStack;
  const draftQuantity = Number.parseInt(quantityDraft, 10);
  const draftValid =
    quantityDraft !== '' &&
    Number.isInteger(draftQuantity) &&
    draftQuantity >= 0 &&
    (item.maxStack === null || draftQuantity <= item.maxStack);

  return (
    <li
      data-testid={`lab-item-${item.d}`}
      data-lab-owned={quantity > 0 ? 'true' : 'false'}
      className="rounded-md border p-2 text-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        {image ? (
          <img src={image} alt="" className="h-8 w-8 rounded object-contain" />
        ) : (
          <span className="text-xl">{item.symbol}</span>
        )}
        <span className="font-bold">{item.name}</span>
        {definitionRarity && (
          <Badge variant="outline" className="text-[9px] capitalize">
            {definitionRarity}
          </Badge>
        )}
        <Badge variant="outline" className="text-[9px]">
          {item.kind === 'wearable' ? 'cosmetic' : 'effect'}
          {definitionCategory && definitionCategory !== 'unknown'
            ? ` · ${definitionCategory}`
            : ''}
        </Badge>
        {definitionSlot && (
          <Badge variant="outline" className="text-[9px]">
            slot: {definitionSlot}
          </Badge>
        )}
        {item.maxStack !== null && (
          <Badge variant="outline" className="text-[9px]">
            max_stack: {item.maxStack}
          </Badge>
        )}
        <span
          data-testid={`lab-quantity-${item.d}`}
          className={cn('font-mono font-bold', quantity === 0 && 'text-muted-foreground')}
        >
          {quantity > 0 ? 'Owned' : 'Not owned'}
          {item.maxStack !== null && quantity > item.maxStack
            ? ` ×${quantity} (exceeds max_stack:${item.maxStack})`
            : quantity > 1
              ? ` ×${quantity}`
              : ''}
        </span>
        {equipped && (
          <Badge variant="secondary" className="text-[9px]">
            equipped
          </Badge>
        )}
        {stale && (
          <Badge variant="destructive" className="text-[9px]">
            stale placement
          </Badge>
        )}
      </div>

      <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
        {item.address}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-1.5 text-[10px]"
          disabled={writesDisabled || atOrAboveMax}
          data-testid={`lab-add-${item.d}`}
          onClick={onAddOne}
          aria-label={`Add ${item.name} to inventory`}
        >
          <Plus className="mr-0.5 h-3 w-3" />
          {atOrAboveMax ? 'Owned' : 'Add to inventory'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-1.5"
          disabled={writesDisabled || quantity === 0}
          data-testid={`lab-remove-${item.d}`}
          onClick={onRemoveOne}
          aria-label={`Remove one ${item.name}`}
        >
          <Minus className="h-3 w-3" />
        </Button>
        <span className="flex items-center gap-1">
          <Input
            value={quantityDraft}
            onChange={(e) => onQuantityDraft(e.target.value)}
            placeholder={item.maxStack !== null ? `0–${item.maxStack}` : 'qty'}
            inputMode="numeric"
            className="h-6 w-14 px-1.5 text-[11px]"
            data-testid={`lab-setqty-input-${item.d}`}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-1.5 text-[10px]"
            disabled={writesDisabled || !draftValid}
            data-testid={`lab-setqty-${item.d}`}
            onClick={() => onSetQuantity(draftQuantity)}
          >
            Set
          </Button>
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-1.5 text-[10px]"
          disabled={writesDisabled || quantity === 0}
          data-testid={`lab-removeall-${item.d}`}
          onClick={onRemoveCompletely}
        >
          <Trash2 className="mr-0.5 h-3 w-3" /> Remove completely
        </Button>
        <CopyButton value={item.address} label="Copy address" className="h-6 text-[10px]" />
        {equipped ? (
          <Button
            variant="secondary"
            size="sm"
            className="h-6 px-1.5 text-[10px]"
            disabled={writesDisabled}
            data-testid={`lab-unequip-item-${item.d}`}
            onClick={onUnequip}
          >
            Unequip
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-6 px-1.5 text-[10px]"
            disabled={writesDisabled || quantity === 0}
            data-testid={`lab-equip-${item.d}`}
            onClick={onEquip}
          >
            Equip
          </Button>
        )}
      </div>

      <details className="mt-1">
        <summary className="cursor-pointer text-[10px] text-muted-foreground">
          Inspect definition & inventory state
        </summary>
        <div className="mt-1 grid gap-1 md:grid-cols-2">
          <pre className="max-h-40 overflow-auto rounded bg-muted p-1.5 text-[10px]">
            {definitionJson}
          </pre>
          <pre className="max-h-40 overflow-auto rounded bg-muted p-1.5 text-[10px]">
            {inventoryJson || 'no inventory loaded'}
          </pre>
        </div>
      </details>
    </li>
  );
}
