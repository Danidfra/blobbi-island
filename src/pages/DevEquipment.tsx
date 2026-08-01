/**
 * DevEquipment — the SIMULATION harness for official wearables and effects
 * (dev-only route `/dev/equipment`; excluded from production builds).
 *
 * ## What this route is, since Phase 9.5b
 *
 * A publish-free playground over ALL SIXTEEN official items: simulate
 * ownership, equip/replace/unequip, apply the documented seven-slot loadout,
 * flip form and facing, and watch the result render through the REAL
 * production paths —
 *
 *   simulated placements → `selectRenderablePlacements` →
 *     `toAccessoryPlacementInput` → accessory source resolution →
 *     `BlobbiRendererView`
 *   simulated inventory + placements → `resolveActiveBlobbiEffects` →
 *     `BlobbiRendererView.effects`
 *
 * so ownership gates, slot policy, form rejection (egg!), stale placements
 * and deterministic effect order here are the SAME code production runs, not
 * a re-implementation. Item identity is the canonical Lab projection of the
 * Phase-9 registries (full official addresses, never event ids), and display
 * data prefers resolved kind:31632 definitions with registry fallbacks.
 *
 * ## What this route is NOT
 *
 * It mutates nothing real: no `useInventoryMutation`, no
 * `useEquipmentMutation`, no signer, no publish, no query-cache writes — a
 * boundary test pins the import graph. Real kind:31633/31634 writes live
 * EXCLUSIVELY in the flag-gated Equipment Lab (`/tools/game-items`,
 * `VITE_ENABLE_LIVE_INVENTORY_LAB=true`); the Live Account section at the
 * bottom explains exactly how to get there. The two surfaces are deliberately
 * not merged: one simulates, one signs.
 */
import { useMemo, useReducer, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  BlobbiRendererView,
  normalizeAccessoryPlacements,
  type AccessoryPlacementInput,
  type BlobbiRenderVisual,
} from '@blobbi/react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { LIVE_INVENTORY_LAB_ENABLED } from '@/lib/feature-flags';
import {
  INITIAL_DEV_SIM_STATE,
  devSimReducer,
  type DevSimStage,
} from '@/lib/dev-equipment-simulation';
import {
  LAB_OFFICIAL_ITEMS,
  LAB_TEST_LOADOUT,
  labItemByAddress,
  type LabOfficialItem,
} from '@/tools/game-items/inventory-equipment-lab';

import { useItemCatalog } from '@/inventory/useItemCatalog';
import { primaryItemImageUrl } from '@/inventory/item-image-resolution';
import { getItemImageByMarker } from '@/inventory/package';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';

import {
  decidePlacementEntry,
  definitionSlot,
  selectRenderablePlacements,
  type PlacementPolicyContext,
} from '@/placement/policy';
import {
  ISLAND_PLACEMENT_REFERENCE,
  toAccessoryPlacementInput,
} from '@/placement/render-model';
import { createPlacementAccessorySourceResolver } from '@/placement/accessory-sources';
import {
  isEffectItemPlacement,
  resolveActiveBlobbiEffects,
  explainEffectRejection,
} from '@/effects/active-effects';

/** The simulation's stand-in identity: author and owner are the same, so the
 * real author gate passes and the policy focuses on the interesting gates. */
const SIM_PUBKEY = 'dev-equipment-simulation';

const BASE_VISUAL = {
  adultType: 'catti',
  baseColor: '#8E6BE8',
  secondaryColor: '#B79CF2',
  eyeColor: '#3A2A1A',
  name: 'Sim Blobbi',
};

const STAGES: readonly DevSimStage[] = ['egg', 'baby', 'adult'];

export function DevEquipment() {
  const catalog = useItemCatalog();
  const [sim, dispatch] = useReducer(devSimReducer, INITIAL_DEV_SIM_STATE);
  const [facing, setFacing] = useState<'front' | 'back'>('front');

  const definitionsByAddress = useMemo(
    () =>
      catalog.data?.byAddress ??
      new Map<string, ResolvedBlobbiItemDefinition>(),
    [catalog.data],
  );

  // ── The real render pipeline, over the simulated state ──────────────────
  const pipeline = useMemo(() => {
    const context: PlacementPolicyContext = {
      authorPubkey: SIM_PUBKEY,
      ownerPubkey: SIM_PUBKEY,
      form: sim.stage,
      quantityByAddress: sim.quantities,
      definitionsByAddress,
    };
    const wearableEntries = sim.placements.filter(
      (entry) => !isEffectItemPlacement(entry),
    );
    const effectEntries = sim.placements.filter(isEffectItemPlacement);

    const renderable = selectRenderablePlacements(wearableEntries, context);
    const renderableSet = new Set(renderable.map((r) => r.entry));
    const accessories: AccessoryPlacementInput[] = [];
    const hidden: { item: string; slot: string | undefined; reason: string }[] = [];
    for (const { entry, slot } of renderable) {
      const result = toAccessoryPlacementInput(entry, slot, ISLAND_PLACEMENT_REFERENCE);
      if (result.ok) accessories.push(result.input);
      else hidden.push({ item: entry.item, slot: entry.slot, reason: result.reason });
    }
    for (const entry of wearableEntries) {
      if (renderableSet.has(entry)) continue;
      hidden.push({
        item: entry.item,
        slot: entry.slot,
        reason: decidePlacementEntry(entry, context).reason ?? 'slot-mismatch',
      });
    }

    const resolution = resolveActiveBlobbiEffects({
      placements: effectEntries,
      quantityByAddress: sim.quantities,
      stage: sim.stage,
    });

    return { accessories, hidden, resolution };
  }, [sim, definitionsByAddress]);

  const resolveSources = useMemo(
    () => createPlacementAccessorySourceResolver({ definitionsByAddress, facing }),
    [definitionsByAddress, facing],
  );
  const renderedAccessories = useMemo(
    () =>
      normalizeAccessoryPlacements(pipeline.accessories, {
        facing,
        resolveSources,
      }),
    [pipeline.accessories, facing, resolveSources],
  );

  const visual: BlobbiRenderVisual = {
    ...BASE_VISUAL,
    stage: sim.stage,
    adultType: sim.stage === 'adult' ? BASE_VISUAL.adultType : undefined,
  };

  const equippedBySlot = useMemo(
    () => new Map(sim.placements.map((p) => [p.slot, p.item])),
    [sim.placements],
  );
  const equippedAddresses = useMemo(
    () => new Set(sim.placements.map((p) => p.item)),
    [sim.placements],
  );

  const slotForItem = (item: LabOfficialItem): string | null =>
    item.kind === 'effect'
      ? item.expectedSlot
      : definitionSlot(definitionsByAddress.get(item.address));

  return (
    <div className="min-h-screen space-y-4 bg-neutral-50 p-4 text-sm dark:bg-neutral-950">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Equipment harness (dev)</h1>
        <p
          data-testid="dev-sim-banner"
          className="inline-block rounded border border-sky-400/50 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
        >
          Simulation only — no Nostr events are published. Real writes live in
          the flag-gated Equipment Lab (see Live Account below).
        </p>
      </header>

      {/* ── Simulation controls ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-2 text-xs dark:bg-neutral-900">
        <span className="font-bold">Form:</span>
        {STAGES.map((stage) => (
          <Button
            key={stage}
            size="sm"
            variant={sim.stage === stage ? 'default' : 'outline'}
            data-testid={`dev-stage-${stage}`}
            onClick={() => dispatch({ type: 'set-stage', stage })}
          >
            {stage}
          </Button>
        ))}
        <span className="ml-2 font-bold">Facing:</span>
        <Button
          size="sm"
          variant="outline"
          data-testid="dev-facing"
          onClick={() => setFacing((f) => (f === 'front' ? 'back' : 'front'))}
        >
          {facing} → show {facing === 'front' ? 'back' : 'front'}
        </Button>
        <label className="ml-2 flex items-center gap-1">
          <input
            type="checkbox"
            checked={sim.allowUnownedEquip}
            data-testid="dev-allow-unowned"
            onChange={(e) =>
              dispatch({ type: 'set-allow-unowned', value: e.target.checked })
            }
          />
          allow unowned equip (creates stale placements)
        </label>
        <Button
          size="sm"
          variant="ghost"
          data-testid="dev-reset"
          onClick={() => dispatch({ type: 'reset' })}
        >
          Reset simulation
        </Button>
      </div>

      {/* ── Bulk simulated inventory ── */}
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Button size="sm" variant="outline" data-testid="dev-own-wearables" onClick={() => dispatch({ type: 'bulk-own', kind: 'wearables' })}>
          Own all official wearables
        </Button>
        <Button size="sm" variant="outline" data-testid="dev-clear-wearables" onClick={() => dispatch({ type: 'bulk-clear', kind: 'wearables' })}>
          Remove all simulated wearables
        </Button>
        <Button size="sm" variant="outline" data-testid="dev-own-effects" onClick={() => dispatch({ type: 'bulk-own', kind: 'effects' })}>
          Own all visual effects
        </Button>
        <Button size="sm" variant="outline" data-testid="dev-clear-effects" onClick={() => dispatch({ type: 'bulk-clear', kind: 'effects' })}>
          Remove all simulated effects
        </Button>
        <Button size="sm" variant="outline" data-testid="dev-own-all" onClick={() => dispatch({ type: 'bulk-own', kind: 'all' })}>
          Own all sixteen
        </Button>
        <Button size="sm" variant="outline" data-testid="dev-clear-all" onClick={() => dispatch({ type: 'bulk-clear', kind: 'all' })}>
          Clear simulated inventory
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {/* ── Wearables and Visual Effects sections ── */}
          {(['wearable', 'effect'] as const).map((kind) => (
            <Card key={kind}>
              <CardHeader>
                <CardTitle className="text-sm">
                  {kind === 'wearable'
                    ? 'Wearables (4 official)'
                    : 'Visual Effects (12 official)'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {LAB_OFFICIAL_ITEMS.filter((item) => item.kind === kind).map(
                  (item) => {
                    const definition = definitionsByAddress.get(item.address);
                    const owned = (sim.quantities.get(item.address) ?? 0) > 0;
                    const equipped = equippedAddresses.has(item.address);
                    const slot = slotForItem(item);
                    const image =
                      (definition ? primaryItemImageUrl(definition) : undefined) ??
                      item.image ??
                      undefined;
                    const hasBackView = definition
                      ? getItemImageByMarker(
                          { images: definition.images },
                          'back',
                        ) !== undefined
                      : false;
                    return (
                      <div
                        key={item.address}
                        data-testid={`dev-item-${item.d}`}
                        className="rounded border p-2"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          {image ? (
                            <img src={image} alt="" className="h-8 w-8 rounded object-contain" />
                          ) : (
                            <span className="text-lg">{item.symbol}</span>
                          )}
                          <span className="font-bold">{item.name}</span>
                          {(definition?.rarity ?? item.rarity) && (
                            <Badge variant="outline" className="text-[9px] capitalize">
                              {definition?.rarity ?? item.rarity}
                            </Badge>
                          )}
                          {slot && (
                            <Badge variant="outline" className="text-[9px]">
                              slot: {slot}
                            </Badge>
                          )}
                          {item.effectId && (
                            <Badge variant="outline" className="text-[9px]">
                              effect: {item.effectId}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[9px]">
                            forms: {(definition?.forms ?? ['baby', 'adult']).join(', ')}
                          </Badge>
                          {kind === 'wearable' && (
                            <Badge variant="outline" className="text-[9px]">
                              back view: {hasBackView ? 'published' : '—'}
                            </Badge>
                          )}
                          {owned && (
                            <Badge variant="secondary" className="text-[9px]">
                              owned (sim)
                            </Badge>
                          )}
                          {equipped && (
                            <Badge className="text-[9px]">equipped (sim)</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
                          {item.address}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-1.5 text-[10px]"
                            data-testid={`dev-own-${item.d}`}
                            onClick={() =>
                              dispatch({
                                type: 'set-owned',
                                address: item.address,
                                owned: !owned,
                              })
                            }
                          >
                            {owned ? 'Simulate unowned' : 'Simulate owned'}
                          </Button>
                          {equipped ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-6 px-1.5 text-[10px]"
                              data-testid={`dev-unequip-${item.d}`}
                              onClick={() => {
                                const occupied = [...equippedBySlot.entries()].find(
                                  ([, address]) => address === item.address,
                                )?.[0];
                                if (occupied) dispatch({ type: 'unequip', slot: occupied });
                              }}
                            >
                              Unequip
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              className="h-6 px-1.5 text-[10px]"
                              disabled={
                                slot === null || (!owned && !sim.allowUnownedEquip)
                              }
                              data-testid={`dev-equip-${item.d}`}
                              onClick={() =>
                                slot &&
                                dispatch({ type: 'equip', address: item.address, slot })
                              }
                            >
                              {slot &&
                              equippedBySlot.has(slot) &&
                              equippedBySlot.get(slot) !== item.address
                                ? `Replace ${labItemByAddress(equippedBySlot.get(slot)!)?.name ?? 'occupant'}`
                                : 'Equip'}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  },
                )}
              </CardContent>
            </Card>
          ))}

          {/* ── Diagnostics ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Diagnostics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs" data-testid="dev-diagnostics">
              {pipeline.hidden.length === 0 &&
                pipeline.resolution.rejected.length === 0 && (
                  <p className="text-muted-foreground">
                    Every simulated placement passed the production policy.
                  </p>
                )}
              {pipeline.hidden.map((h, i) => (
                <p key={`h-${i}`} className="text-amber-700 dark:text-amber-400">
                  ✗ wearable {labItemByAddress(h.item)?.name ?? h.item} in{' '}
                  {h.slot ?? '?'} — {h.reason}
                </p>
              ))}
              {pipeline.resolution.rejected.map((r, i) => (
                <p key={`r-${i}`} className="text-amber-700 dark:text-amber-400">
                  ✗ effect {r.registration.name} — {r.reason}:{' '}
                  {explainEffectRejection(r.reason)}
                </p>
              ))}
            </CardContent>
          </Card>

          {/* ── Live Account ── */}
          <Card data-testid="dev-live-account">
            <CardHeader>
              <CardTitle className="text-sm">Live Account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <p>
                Everything above is LOCAL SIMULATION. To put items in your real
                kind:31633 inventory and equip them through real kind:31634
                events, use the Equipment Lab in the Game Item Tools — it signs
                with your account and every write requires confirmation.
              </p>
              {LIVE_INVENTORY_LAB_ENABLED ? (
                <Button asChild size="sm" data-testid="dev-open-lab">
                  <Link to="/tools/game-items?tab=lab">Open Live Equipment Lab</Link>
                </Button>
              ) : (
                <pre
                  data-testid="dev-lab-disabled-instructions"
                  className="whitespace-pre-wrap rounded bg-muted p-2 text-[11px]"
                >
{`Real inventory editing is disabled in this build.
Enable it with a local env file, then FULLY restart Vite
(hot reload cannot change build-time variables):

  # .env.local
  VITE_ENABLE_LIVE_INVENTORY_LAB=true

Then open: Tools → Game Items → Equipment Lab
(or: npm run dev:inventory-lab)`}
                </pre>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Active Loadout: the real renderer over the simulated state ── */}
        <div className="space-y-2">
          <Card className="sticky top-4">
            <CardHeader>
              <CardTitle className="text-sm">Active loadout (simulated)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div
                data-testid="dev-stage-render"
                className="flex h-80 items-center justify-center rounded-lg"
                style={{ background: 'linear-gradient(180deg,#FFF4D8,#FBEAC2)' }}
              >
                <BlobbiRendererView
                  visual={visual}
                  instanceId="dev-equipment-sim"
                  size="2xl"
                  facing={facing}
                  accessories={renderedAccessories}
                  effects={pipeline.resolution.effects}
                />
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="dev-apply-loadout"
                  onClick={() => dispatch({ type: 'apply-loadout' })}
                >
                  Apply simulated full loadout
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="dev-clear-loadout"
                  onClick={() => dispatch({ type: 'clear-loadout' })}
                >
                  Clear simulated loadout
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Loadout: {LAB_TEST_LOADOUT.map((s) => s.slot).join(' · ')}. Steps
                whose item is not simulated-owned are skipped — own all sixteen
                first, or enable the stale-placement override.
              </p>
              <ul className="space-y-0.5 text-[11px]" data-testid="dev-active-list">
                {sim.placements.length === 0 && (
                  <li className="text-muted-foreground">Nothing equipped (sim).</li>
                )}
                {sim.placements.map((p) => (
                  <li key={p.slot}>
                    <span className="font-mono">{p.slot}</span> →{' '}
                    {labItemByAddress(p.item)?.name ?? p.item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default DevEquipment;
