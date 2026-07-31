/**
 * PlacementOverlay — the interactive editing surface for kind:31634 equipment.
 *
 * Replaces the legacy `AccessoryOverlay`. The drag/wheel maths is unchanged
 * (it was correct and is documented in `docs/blobbi-renderer-contract.md`);
 * what changed is what it edits: a placement entry keyed by SLOT, not a legacy
 * equip tag keyed by accessory code.
 *
 * Coordinate contract: `containerRef` must wrap exactly the canonical renderer
 * box, so the drag percentages are percentages OF THAT BOX — the same space
 * `ISLAND_PLACEMENT_REFERENCE` declares (`2d`, `percent`, `top-left`, 100x100).
 * No conversion happens anywhere; that is the point of choosing that reference.
 *
 * Artwork comes from the same resolver the world uses
 * (`createPlacementAccessorySourceResolver`), keyed by item address, so the
 * editor can never show a different picture from the world.
 *
 * NOTHING HERE PUBLISHES. Edits are reported upward as transform patches; the
 * modal batches them and hands them to `useEquipmentMutation`, which publishes
 * ONE complete replacement document. That is why dragging three hats costs one
 * event rather than three.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ACCESSORY_BASE_PERCENT, normalizeAccessoryPlacements } from '@blobbi/react';
import type { AccessoryPlacementInput, AccessorySlot } from '@blobbi/react';

import { cn } from '@/lib/utils';
import { createPlacementAccessorySourceResolver } from '@/placement/accessory-sources';
import type { PlacementTransformPatch } from '@/placement/useEquipmentMutation';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';

export interface PlacementOverlayProps {
  className?: string;
  /**
   * Renderer-ready accessories, already filtered by Island policy — the exact
   * value the world renders. The editor never re-decides what may be shown.
   */
  accessories: readonly AccessoryPlacementInput[];
  /** `itemAddress → definition`, for artwork. */
  definitionsByAddress: ReadonlyMap<string, ResolvedBlobbiItemDefinition>;
  /** Which way the Blobbi is turned; drops face-only slots when `back`. */
  facing?: 'front' | 'back';
  /** Unsaved transform edits, keyed by slot. */
  pendingUpdates?: Record<string, PlacementTransformPatch>;
  /** Ref to the element that IS the canonical renderer box. */
  containerRef?: React.RefObject<HTMLDivElement>;
  /** Currently selected slot, if any. */
  selectedSlot?: AccessorySlot | null;
  onSelectSlot?: (slot: AccessorySlot) => void;
  onTransformChange?: (slot: AccessorySlot, patch: PlacementTransformPatch) => void;
}

interface PlacementItemProps {
  placement: AccessoryPlacementInput;
  slot: AccessorySlot;
  sources: readonly string[];
  containerRef?: React.RefObject<HTMLDivElement>;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (patch: PlacementTransformPatch) => void;
}

function PlacementItem({
  placement,
  slot,
  sources,
  containerRef,
  isSelected,
  onSelect,
  onUpdate,
}: PlacementItemProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!containerRef?.current) return;

      onSelect();

      const rect = containerRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left - (placement.x / 100) * rect.width,
        y: e.clientY - rect.top - (placement.y / 100) * rect.height,
      });
      setIsDragging(true);
    },
    [placement.x, placement.y, containerRef, onSelect],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef?.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newX = ((e.clientX - rect.left - dragOffset.x) / rect.width) * 100;
      const newY = ((e.clientY - rect.top - dragOffset.y) / rect.height) * 100;
      // Constrained to the box; decimals are preserved end to end, because the
      // protocol stores real numbers and nothing rounds them.
      onUpdate({
        x: Math.max(5, Math.min(95, newX)),
        y: Math.max(5, Math.min(95, newY)),
      });
    },
    [isDragging, dragOffset, containerRef, onUpdate],
  );

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!isSelected) return;
      e.preventDefault();
      if (e.shiftKey) {
        const delta = e.deltaY > 0 ? 5 : -5;
        onUpdate({ rot: Math.max(-45, Math.min(45, placement.rot + delta)) });
      } else {
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        onUpdate({ scale: Math.max(0.25, Math.min(2.0, placement.scale + delta)) });
      }
    },
    [isSelected, placement.rot, placement.scale, onUpdate],
  );

  useEffect(() => {
    if (!isDragging) return;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Index into `sources`, advanced by onError; reset when the list changes.
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => setSourceIndex(0), [sources]);
  const imageUrl = sources[sourceIndex] ?? '';

  return (
    <div
      data-placement-slot={slot}
      className={cn(
        'absolute select-none transition-all duration-200 z-20 cursor-move pointer-events-auto',
        isDragging && 'opacity-80 scale-105',
        isSelected && 'ring-2 ring-blue-500 ring-offset-2',
      )}
      style={{
        left: `${placement.x}%`,
        top: `${placement.y}%`,
        width: ACCESSORY_BASE_PERCENT,
        height: ACCESSORY_BASE_PERCENT,
        transform: `translate(-50%, -50%) scale(${placement.scale}) rotate(${placement.rot}deg) ${placement.flipX ? 'scaleX(-1)' : ''}`,
        transformOrigin: 'center',
      }}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      title={`${slot} — click to select, drag to move, scroll to scale, shift+scroll to rotate`}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={slot}
          className="h-full w-full max-w-none object-contain"
          draggable={false}
          onError={() => setSourceIndex((i) => i + 1)}
        />
      ) : null}
    </div>
  );
}

export function PlacementOverlay({
  className,
  accessories,
  definitionsByAddress,
  facing = 'front',
  pendingUpdates = {},
  containerRef,
  selectedSlot,
  onSelectSlot,
  onTransformChange,
}: PlacementOverlayProps) {
  const resolveSources = useMemo(
    () => createPlacementAccessorySourceResolver({ definitionsByAddress, facing }),
    [definitionsByAddress, facing],
  );

  // Reuse the package normalizer purely for its deterministic paint order and
  // rear-view filtering, so the editor stacks accessories exactly as the world
  // does; the editor then works on the raw inputs it was given.
  const bySlot = new Map(accessories.map((a) => [a.slot, a] as const));
  const ordered = normalizeAccessoryPlacements([...accessories], { facing })
    .map((n) => bySlot.get(n.slot))
    .filter((a): a is AccessoryPlacementInput => a !== undefined);

  if (ordered.length === 0) return null;

  return (
    <div className={cn('absolute inset-0', className)}>
      {ordered.map((accessory) => {
        const patch = pendingUpdates[accessory.slot] ?? {};
        const current: AccessoryPlacementInput = {
          ...accessory,
          x: patch.x ?? accessory.x,
          y: patch.y ?? accessory.y,
          scale: patch.scale ?? accessory.scale,
          rot: patch.rot ?? accessory.rot,
          flipX: patch.flipX ?? accessory.flipX,
        };
        return (
          <PlacementItem
            key={accessory.slot}
            placement={current}
            slot={accessory.slot}
            sources={resolveSources({
              code: current.code,
              slot: current.slot,
              ...(current.url === undefined ? {} : { url: current.url }),
            })}
            {...(containerRef ? { containerRef } : {})}
            isSelected={selectedSlot === accessory.slot}
            onSelect={() => onSelectSlot?.(accessory.slot)}
            onUpdate={(update) => onTransformChange?.(accessory.slot, update)}
          />
        );
      })}
    </div>
  );
}
