/**
 * DevEquipment — development-only inspector for the item/equipment stack.
 *
 * DEVELOPMENT ONLY. Mounted from `AppRouter` behind `import.meta.env.DEV`, so
 * a production build collapses the branch to `null`, drops the dynamic import,
 * and never emits this chunk. `src/dev-routes.test.ts` asserts that against the
 * built output.
 *
 * WHAT MAKES IT USEFUL IS THAT IT IS NOT A SIMULATOR. Every control here goes
 * through the same service boundary production uses:
 *
 *   inventory changes → `useInventoryMutation` (kind:31633)
 *   equip / unequip   → `useEquipmentMutation` (kind:31634)
 *   definitions       → `useItemCatalog` (kind:31632, official issuer only)
 *
 * There is deliberately NO local placement state, no fake catalog and no
 * in-memory inventory. A developer who equips something here publishes exactly
 * the event a player would, which is the only way this tool can prove anything
 * about production behavior.
 *
 * Adding inventory quantity from here is DEVELOPER TOOLING, not a migration and
 * not a grant: it writes the player's own kind:31633 event, exactly as the shop
 * and arcade already do.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AccessorySlot } from '@blobbi/react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCurrentPet } from '@/hooks/useOptimizedStatus';
import { useItemCatalog } from '@/inventory/useItemCatalog';
import { useIslandInventory, inventoryQueryKey } from '@/inventory/useIslandInventory';
import { useInventoryMutation } from '@/inventory/useInventoryMutation';
import { getInventoryItems } from '@/inventory/package';
import {
  ADDRESSED_OFFICIAL_COSMETICS,
  OFFICIAL_ISSUER_PUBKEY,
} from '@/protocol/event-registry';

import {
  usePlacementState,
  placementQueryKey,
} from '@/placement/usePlacementState';
import {
  useEquipmentMutation,
  buildEquipmentTemplate,
  applyEquipmentMutation,
  type PlacementTransformPatch,
} from '@/placement/useEquipmentMutation';
import { buildEquipEntry } from '@/placement/render-model';
import { characterEquipmentPlacementAddress } from '@/placement/identity';
import { definitionSlot, decidePlacementEntry } from '@/placement/policy';
import { useEquippableCosmetics, explainUnavailable } from '@/placement/useEquippableCosmetics';

export function DevEquipment() {
  const { user } = useCurrentUser();
  const currentPet = useCurrentPet();
  const queryClient = useQueryClient();

  const characterId = currentPet?.id;
  const form = currentPet?.stage;

  const catalog = useItemCatalog();
  const inventoryQuery = useIslandInventory();
  const placementQuery = usePlacementState(characterId);
  const cosmetics = useEquippableCosmetics(form);

  const inventoryMutation = useInventoryMutation();
  const equipmentMutation = useEquipmentMutation();

  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const quantities = new Map(
    inventoryQuery.data
      ? getInventoryItems(inventoryQuery.data).map((i) => [i.address, i.quantity])
      : [],
  );
  const state = placementQuery.data;

  const run = async (label: string, task: () => Promise<unknown>) => {
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const refresh = () => {
    // Re-read relay state through the real query keys, so what appears here is
    // what production would next read.
    void queryClient.invalidateQueries({ queryKey: inventoryQueryKey(user?.pubkey) });
    void queryClient.invalidateQueries({
      queryKey: placementQueryKey(user?.pubkey, characterId),
    });
    void catalog.refetch();
  };

  /**
   * Build the exact unsigned event the next publish would send, WITHOUT
   * publishing it. Uses the same builder the mutation uses, so a preview that
   * looks right is evidence about the real write path rather than a mock-up.
   */
  const previewEvent = (
    mutation: Parameters<typeof applyEquipmentMutation>[1],
  ) => {
    if (!state || !user?.pubkey || !characterId) return;
    try {
      const next = applyEquipmentMutation(state.placement, mutation);
      const template = buildEquipmentTemplate(next, {
        ownerPubkey: user.pubkey,
        characterId,
        ...(currentPet?.name === undefined ? {} : { characterName: currentPet.name }),
        baseRevision: state.isEmpty ? undefined : state.placement.revision,
      });
      setPreview(JSON.stringify(template, null, 2));
    } catch (e) {
      setError(`preview: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (!user?.pubkey) {
    return <Shell>Log in to inspect equipment state.</Shell>;
  }

  return (
    <Shell>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Equipment inspector (dev)</h1>
        <Button size="sm" variant="outline" onClick={refresh}>
          Re-read relay state
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {/* ------------------------------------------------ definitions ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Official kind:31632 cosmetics ({ADDRESSED_OFFICIAL_COSMETICS.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <p className="text-muted-foreground">
            Trusted issuer <code className="break-all">{OFFICIAL_ISSUER_PUBKEY}</code>
          </p>
          {ADDRESSED_OFFICIAL_COSMETICS.length === 0 && (
            <p className="text-muted-foreground">
              No official cosmetic identities are registered. Production shows an
              empty catalog — this is the honest state, not an error.
            </p>
          )}
          {ADDRESSED_OFFICIAL_COSMETICS.map((official) => {
            const definition = catalog.data?.byAddress.get(official.address);
            const quantity = quantities.get(official.address) ?? 0;
            const slot = definitionSlot(definition);
            return (
              <div key={official.address} className="space-y-1 rounded border p-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{definition?.name ?? official.name}</p>
                    <p className="break-all text-muted-foreground">{official.address}</p>
                  </div>
                  <Badge variant={definition?.source === 'definition' ? 'default' : 'outline'}>
                    {definition?.source ?? 'unresolved'}
                  </Badge>
                </div>

                <dl className="grid grid-cols-2 gap-x-2">
                  <dt className="text-muted-foreground">slot</dt>
                  <dd>
                    {definition?.slot ?? '—'}{' '}
                    <span className="text-muted-foreground">
                      ({definition?.visualDiagnostics.slot ?? 'unknown'})
                    </span>
                  </dd>
                  <dt className="text-muted-foreground">forms</dt>
                  <dd>
                    {definition?.forms?.join(', ') ?? '—'}{' '}
                    <span className="text-muted-foreground">
                      ({definition?.visualDiagnostics.forms ?? 'unknown'})
                    </span>
                  </dd>
                  <dt className="text-muted-foreground">owned (31633)</dt>
                  <dd>{quantity}</dd>
                  <dt className="text-muted-foreground">equippable</dt>
                  <dd>{slot !== null && quantity > 0 ? 'yes' : 'no'}</dd>
                </dl>

                <div className="flex flex-wrap gap-1">
                  {(definition?.images ?? []).map((image, i) => (
                    <figure key={`${image.url}-${i}`} className="w-16 text-center">
                      <img src={image.url} alt={image.marker ?? 'primary'} className="h-12 w-full object-contain" />
                      <figcaption className="text-[10px] text-muted-foreground">
                        {image.marker ?? 'primary'}
                      </figcaption>
                    </figure>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={inventoryMutation.isPending}
                    onClick={() =>
                      void run('add to inventory', () =>
                        inventoryMutation.mutateAsync({
                          type: 'add',
                          address: official.address,
                          amount: 1,
                        }),
                      )
                    }
                  >
                    +1 inventory
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={inventoryMutation.isPending || quantity === 0}
                    onClick={() =>
                      void run('remove from inventory', () =>
                        inventoryMutation.mutateAsync({
                          type: 'remove',
                          address: official.address,
                          amount: 1,
                        }),
                      )
                    }
                  >
                    −1 inventory
                  </Button>
                  {slot !== null && (
                    <>
                      <Button
                        size="sm"
                        disabled={equipmentMutation.isPending || !characterId}
                        onClick={() =>
                          void run('equip', () =>
                            equipmentMutation.mutateAsync({
                              characterId: characterId!,
                              mutation: {
                                type: 'equip',
                                slot,
                                entry: buildEquipEntry({
                                  itemAddress: official.address,
                                  slot,
                                }),
                              },
                            }),
                          )
                        }
                      >
                        Equip
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          previewEvent({
                            type: 'equip',
                            slot,
                            entry: buildEquipEntry({
                              itemAddress: official.address,
                              slot,
                            }),
                          })
                        }
                      >
                        Preview event
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {cosmetics.unavailable.length > 0 && (
            <>
              <Separator />
              <ul className="space-y-0.5 text-muted-foreground">
                {cosmetics.unavailable.map((item) => (
                  <li key={item.address}>
                    {item.definition?.name ?? item.address} — {explainUnavailable(item.reason)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {/* -------------------------------------------------- placement ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Current kind:31634 document</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {!characterId ? (
            <p className="text-muted-foreground">No current Blobbi selected.</p>
          ) : !state ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-0.5">
                <dt className="text-muted-foreground">address</dt>
                <dd className="break-all">
                  {characterEquipmentPlacementAddress(user.pubkey, characterId)}
                </dd>
                <dt className="text-muted-foreground">published</dt>
                <dd>{state.isEmpty ? 'no event yet' : 'yes'}</dd>
                <dt className="text-muted-foreground">revision</dt>
                <dd>{state.placement.revision ?? '—'}</dd>
                <dt className="text-muted-foreground">target</dt>
                <dd className="break-all">{JSON.stringify(state.placement.target) ?? '—'}</dd>
                <dt className="text-muted-foreground">reference</dt>
                <dd className="break-all">{JSON.stringify(state.placement.reference) ?? '—'}</dd>
              </dl>

              {state.warnings.length > 0 && (
                <ul className="rounded border border-amber-400/40 bg-amber-50/40 p-2 dark:bg-amber-950/20">
                  {state.warnings.map((w, i) => (
                    <li key={`${w.code}-${i}`}>
                      <code>{w.code}</code> — {w.message}
                    </li>
                  ))}
                </ul>
              )}

              {state.placement.placements.length === 0 ? (
                <p className="text-muted-foreground">No placements.</p>
              ) : (
                <ul className="space-y-1">
                  {state.placement.placements.map((entry) => {
                    const decision = decidePlacementEntry(entry, {
                      authorPubkey: state.placement.author,
                      ownerPubkey: user.pubkey,
                      form,
                      quantityByAddress: quantities,
                      definitionsByAddress:
                        catalog.data?.byAddress ?? new Map(),
                    });
                    const slot = entry.slot as AccessorySlot | undefined;
                    return (
                      <li key={entry.id} className="rounded border p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{entry.slot ?? entry.id}</span>
                          <Badge variant={decision.allowed ? 'default' : 'destructive'}>
                            {decision.allowed ? 'rendered' : decision.reason}
                          </Badge>
                        </div>
                        <p className="break-all text-muted-foreground">{entry.item}</p>
                        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[10px]">
                          {JSON.stringify(entry, null, 2)}
                        </pre>
                        {slot && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {(
                              [
                                ['x −5', { x: (entry.position?.x ?? 50) - 5 }],
                                ['x +5', { x: (entry.position?.x ?? 50) + 5 }],
                                ['y −5', { y: (entry.position?.y ?? 50) - 5 }],
                                ['y +5', { y: (entry.position?.y ?? 50) + 5 }],
                                ['scale +0.1', { scale: (entry.scale?.x ?? 1) + 0.1 }],
                                ['rot +5', {
                                  rot:
                                    (entry.rotation?.type === 'euler' &&
                                    typeof entry.rotation.z === 'number'
                                      ? entry.rotation.z
                                      : 0) + 5,
                                }],
                                ['flip', { flipX: !(entry.flip?.x ?? false) }],
                              ] as [string, PlacementTransformPatch][]
                            ).map(([label, patch]) => (
                              <Button
                                key={label}
                                size="sm"
                                variant="outline"
                                disabled={equipmentMutation.isPending}
                                onClick={() =>
                                  void run('edit transform', () =>
                                    equipmentMutation.mutateAsync({
                                      characterId,
                                      mutation: {
                                        type: 'set-transforms',
                                        transforms: { [slot]: patch },
                                      },
                                    }),
                                  )
                                }
                              >
                                {label}
                              </Button>
                            ))}
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={equipmentMutation.isPending}
                              onClick={() =>
                                void run('unequip', () =>
                                  equipmentMutation.mutateAsync({
                                    characterId,
                                    mutation: { type: 'unequip', slot },
                                  }),
                                )
                              }
                            >
                              Unequip
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Unsigned event preview</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[10px]">
              {preview}
            </pre>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
              Close
            </Button>
          </CardContent>
        </Card>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">{children}</div>
  );
}

export default DevEquipment;
