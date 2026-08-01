/**
 * Inventory & Equipment Lab — internal developer tool for REAL kind:31633 and
 * kind:31634 mutations against the CURRENT account.
 *
 * ## Access and safety policy (see docs/inventory-equipment-lab.md)
 *
 * Lives in `/tools/game-items` — reachable by direct URL, linked from no
 * player navigation, shipped in production because it must work against
 * production relays. Obscurity is NOT authorization: the real boundary is
 * that every write requires an explicit click and a signature from the
 * logged-in account, and can only ever touch THAT account's own inventory
 * and its own Blobbi's equipment document. Without a signer every write
 * control is disabled.
 *
 * The three roles stay visibly apart: the official ISSUER authored the
 * kind:31632 definitions (shown as the trust root); the PLAYER — the signer —
 * owns kind:31633 and equips through kind:31634. This lab acts only as the
 * player.
 *
 * ## What a write is, and is not
 *
 * Every mutation flows through the SAME two production writers
 * (`useInventoryMutation`, `useEquipmentMutation`): serialized, fresh-read
 * based, optimistic with rollback, reconciled after publish. Bulk actions
 * compute ONE final state and publish ONE canonical replacement event —
 * previewed as a diff and confirmed before signing. Inventory writes never
 * equip; equipping never grants; removing an owned item never silently edits
 * the placement document (a stale placement stays, diagnosed, with its own
 * explicit remove action).
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
import { useIslandInventory } from '@/inventory/useIslandInventory';
import {
  useInventoryMutation,
  type InventoryMutation,
  type InventorySetTarget,
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
  type LabInventoryPlan,
  type LabLoadoutPlan,
  type LabOfficialItem,
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
};

/** A write awaiting explicit confirmation, with its complete diff. */
type PendingWrite =
  | { kind: 'inventory'; title: string; plan: LabInventoryPlan }
  | {
      kind: 'inventory-targets';
      title: string;
      description: string;
      targets: readonly InventorySetTarget[];
    }
  | {
      kind: 'equipment';
      title: string;
      description: string;
      mutation: EquipmentMutation;
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
  const equipment = useCharacterEquipment(characterId, {
    ...(currentPet?.stage === undefined ? {} : { form: currentPet.stage }),
  });
  const placementQuery = usePlacementState(characterId);

  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});

  const signedIn = Boolean(user?.pubkey);
  const busy = inventoryMutation.isPending || equipmentMutation.isPending;
  const writesDisabled = !signedIn || busy;

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

  // ── Write helpers: every publish goes through here, post-confirmation. ──

  const runInventory = async (mutation: InventoryMutation, success: string) => {
    try {
      await inventoryMutation.mutateAsync(mutation);
      toast({ title: success });
    } catch (error) {
      toast({
        title: 'Inventory write failed',
        description: error instanceof Error ? error.message : 'Publish failed.',
        variant: 'destructive',
      });
    }
  };

  const runEquipment = async (mutation: EquipmentMutation, success: string) => {
    if (!characterId) {
      toast({ title: 'No target Blobbi', variant: 'destructive' });
      return;
    }
    try {
      await equipmentMutation.mutateAsync({
        characterId,
        ...(currentPet?.name === undefined ? {} : { characterName: currentPet.name }),
        mutation,
      });
      toast({ title: success });
    } catch (error) {
      toast({
        title: 'Equipment write failed',
        description: error instanceof Error ? error.message : 'Publish failed.',
        variant: 'destructive',
      });
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    const write = pending;
    setPending(null);
    if (write.kind === 'inventory') {
      await runInventory(
        { type: 'set-many', targets: [...write.plan.targets] },
        `${BULK_ACTION_LABELS[write.plan.action]} — published`,
      );
    } else if (write.kind === 'inventory-targets') {
      await runInventory(
        { type: 'set-many', targets: [...write.targets] },
        `${write.title} — published`,
      );
    } else if (write.kind === 'equipment') {
      await runEquipment(write.mutation, `${write.title} — published`);
    } else {
      await runEquipment(
        { type: 'apply-set', equips: [...write.plan.equips], unequips: [] },
        'Test loadout — published',
      );
    }
  };

  // ── Row-level actions ────────────────────────────────────────────────────

  const equipItem = (item: LabOfficialItem) => {
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
    void runEquipment(
      {
        type: 'equip',
        slot,
        entry: { id: slot, item: item.address, mode: 'equip', slot },
      },
      `${item.name} equipped`,
    );
  };

  const unequipAddress = (address: string) => {
    const slots = [...equippedBySlot.entries()]
      .filter(([, entry]) => entry.item === address)
      .map(([slot]) => slot);
    if (slots.length === 0) return;
    void runEquipment({ type: 'unequip', slot: slots[0] }, 'Unequipped');
  };

  // ── Bulk equipment plans ─────────────────────────────────────────────────

  const unequipAllOfKind = (kind: 'wearable' | 'effect') => {
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
      description: `Removes ${slots.length} slot${slots.length === 1 ? '' : 's'}: ${slots.join(', ')}. Unrelated placements are preserved. Inventory quantities do not change.`,
      mutation: { type: 'apply-set', equips: [], unequips: slots },
    });
  };

  const stalePlacements = useMemo(
    () =>
      [...equippedBySlot.entries()].filter(
        ([, entry]) => (quantities.get(entry.item) ?? 0) <= 0,
      ),
    [equippedBySlot, quantities],
  );

  const clearStalePlacements = () => {
    if (stalePlacements.length === 0) {
      toast({ title: 'No stale placements' });
      return;
    }
    setPending({
      kind: 'equipment',
      title: 'Clear stale placements',
      description: `Removes ${stalePlacements
        .map(([slot, entry]) => `${slot} (${labItemByAddress(entry.item)?.name ?? entry.item})`)
        .join(', ')}. Only slots whose item is no longer in the inventory are touched.`,
      mutation: {
        type: 'apply-set',
        equips: [],
        unequips: stalePlacements.map(([slot]) => slot),
      },
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
          Internal developer lab — every action here publishes REAL signed events.
        </p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Official item issuer (31632)</dt>
          <dd className="font-mono" data-testid="lab-issuer">
            {shortHex(OFFICIAL_ITEM_ISSUER_PUBKEY)} — trust root; this lab never
            writes as the issuer
          </dd>
          <dt className="text-muted-foreground">Inventory owner (31633)</dt>
          <dd className="font-mono" data-testid="lab-owner">
            {signedIn ? (
              <>
                {npub ? `${shortHex(npub, 12, 6)} · ` : ''}
                {shortHex(user!.pubkey)} (you — the signer)
              </>
            ) : (
              'no signer'
            )}
          </dd>
          <dt className="text-muted-foreground">Equipment target (31634)</dt>
          <dd data-testid="lab-target-blobbi">
            {characterId
              ? `${currentPet?.name ?? characterId} · ${characterId} · ${currentPet?.stage ?? 'unknown stage'}`
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
                onClick={() => {
                  const plan = planBulkInventoryAction(action, quantities);
                  if (plan.changes.length === 0) {
                    toast({ title: 'Nothing would change' });
                    return;
                  }
                  setPending({
                    kind: 'inventory',
                    title: BULK_ACTION_LABELS[action],
                    plan,
                  });
                }}
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
            {LAB_OFFICIAL_ITEMS.filter((item) => item.kind === kind).map((item) => (
              <LabItemRow
                key={item.address}
                item={item}
                quantity={quantities.get(item.address) ?? 0}
                equipped={equippedAddresses.has(item.address)}
                stale={
                  equippedAddresses.has(item.address) &&
                  (quantities.get(item.address) ?? 0) <= 0
                }
                definitionImage={(() => {
                  const definition = catalogQuery.data?.byAddress.get(item.address);
                  return definition ? primaryItemImageUrl(definition) : undefined;
                })()}
                definitionRarity={
                  catalogQuery.data?.byAddress.get(item.address)?.rarity ?? item.rarity
                }
                definitionSlot={
                  item.kind === 'effect'
                    ? item.expectedSlot
                    : (catalogQuery.data?.byAddress.get(item.address)?.slot ?? null)
                }
                definitionCategory={
                  catalogQuery.data?.byAddress.get(item.address)?.category
                }
                inventoryJson={
                  inventory ? JSON.stringify(getInventoryItems(inventory), null, 2) : ''
                }
                definitionJson={JSON.stringify(
                  catalogQuery.data?.byAddress.get(item.address) ?? null,
                  null,
                  2,
                )}
                writesDisabled={writesDisabled}
                quantityDraft={quantityDrafts[item.address] ?? ''}
                onQuantityDraft={(value) =>
                  setQuantityDrafts((prev) => ({ ...prev, [item.address]: value }))
                }
                onAddOne={() =>
                  void runInventory(
                    { type: 'add', address: item.address, amount: 1 },
                    `${item.name} +1`,
                  )
                }
                onRemoveOne={() =>
                  void runInventory(
                    { type: 'remove', address: item.address, amount: 1 },
                    `${item.name} −1`,
                  )
                }
                onSetQuantity={(quantity) =>
                  setPending({
                    kind: 'inventory-targets',
                    title: `Set ${item.name} to ${quantity}`,
                    description: `Sets the quantity of ${item.name} from ${quantities.get(item.address) ?? 0} to ${quantity}. Every other inventory entry is preserved.`,
                    targets: [{ address: item.address, quantity }],
                  })
                }
                onRemoveCompletely={() =>
                  setPending({
                    kind: 'inventory-targets',
                    title: `Remove ${item.name} completely`,
                    description: `Sets ${item.name} (currently ×${quantities.get(item.address) ?? 0}) to zero. The entry is omitted from the next inventory event, as the protocol specifies. Any equipped placement of it becomes STALE and stays in the equipment document until you remove it explicitly.`,
                    targets: [{ address: item.address, quantity: 0 }],
                  })
                }
                onEquip={() => equipItem(item)}
                onUnequip={() => unequipAddress(item.address)}
              />
            ))}
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
            onClick={() => unequipAllOfKind('effect')}
          >
            Unequip all effects
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={writesDisabled || !characterId}
            data-testid="lab-unequip-all-wearables"
            onClick={() => unequipAllOfKind('wearable')}
          >
            Unequip all wearables
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={writesDisabled || !characterId}
            data-testid="lab-clear-stale"
            onClick={clearStalePlacements}
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
                        stale — not owned
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
                        onClick={() =>
                          void runEquipment(
                            { type: 'unequip', slot },
                            `${slot} cleared`,
                          )
                        }
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

      {/* ── Confirmation dialog: the complete diff, then the signature ── */}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === 'loadout'
                ? 'Apply the full test loadout'
                : pending?.kind === 'inventory'
                  ? BULK_ACTION_LABELS[pending.plan.action]
                  : pending?.title}
            </DialogTitle>
            <DialogDescription data-testid="lab-confirm-kind">
              {pending?.kind === 'equipment' || pending?.kind === 'loadout'
                ? 'This will publish a signed kind:31634 event.'
                : 'This will publish a signed kind:31633 event.'}
            </DialogDescription>
          </DialogHeader>

          {pending?.kind === 'inventory' && (
            <ul
              data-testid="lab-confirm-diff"
              className="max-h-56 space-y-0.5 overflow-y-auto text-xs"
            >
              {pending.plan.changes.map((change) => (
                <li key={change.address} className="flex justify-between gap-2">
                  <span>{change.name}</span>
                  <span className="font-mono">
                    {change.from} → {change.to}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {pending?.kind === 'inventory-targets' && (
            <p className="text-xs">{pending.description}</p>
          )}
          {pending?.kind === 'equipment' && (
            <p className="text-xs">{pending.description}</p>
          )}
          {pending?.kind === 'loadout' && (
            <div className="space-y-2 text-xs">
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
                    the missing items first — that is a SEPARATE kind:31633
                    write with its own confirmation.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1.5"
                    data-testid="lab-loadout-add-missing"
                    onClick={() =>
                      setPending({
                        kind: 'inventory-targets',
                        title: 'Add required loadout items',
                        description: `Sets quantity 1 for: ${pending.plan.missing
                          .map((m) => m.name)
                          .join(', ')}. Nothing is equipped by this write.`,
                        targets: planMissingLoadoutItems(pending.plan),
                      })
                    }
                  >
                    Add required items to inventory first
                  </Button>
                </div>
              )}
              <p className="text-muted-foreground">
                Quantities are not modified by applying the loadout.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
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
  const draftQuantity = Number.parseInt(quantityDraft, 10);
  const draftValid =
    quantityDraft !== '' && Number.isInteger(draftQuantity) && draftQuantity >= 0;

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
        <span
          data-testid={`lab-quantity-${item.d}`}
          className={cn('font-mono font-bold', quantity === 0 && 'text-muted-foreground')}
        >
          ×{quantity}
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
          className="h-6 px-1.5"
          disabled={writesDisabled}
          data-testid={`lab-add-${item.d}`}
          onClick={onAddOne}
          aria-label={`Add one ${item.name}`}
        >
          <Plus className="h-3 w-3" />
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
            placeholder="qty"
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
