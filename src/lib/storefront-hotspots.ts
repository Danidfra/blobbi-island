/**
 * A storefront painted into a room's background, made pressable.
 *
 * The mall composes each shop from a facade sprite, so its click target is the
 * sprite. A room whose shops are baked into the plate has no sprite to click,
 * the Plaza is the first, so the target is a rectangle over the painted bay
 * and a stand point in front of it. This is the shape of that rectangle; the
 * component that draws and drives it is `StorefrontHotspot`.
 *
 * `destination` carries the whole "is it open yet" decision. A `LocationId`
 * means walk there and go in; `null` means walk there and say "Coming soon".
 * Opening a shop is one edit to one field, and nothing about how the hotspot
 * looks or feels changes with it.
 */

import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';

/** A rectangle in world percent. */
export interface WorldBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StorefrontHotspotConfig {
  /** Stable id; also the hotspot's `data-storefront` value. */
  readonly id: string;
  /** The shop's visible name, as painted on its sign. */
  readonly name: string;
  /** The painted bay the hotspot covers. */
  readonly box: WorldBox;
  /** Where the player walks to before anything happens. On the floor. */
  readonly standPoint: Position;
  /** The room inside, or `null` while it does not exist yet. */
  readonly destination: LocationId | null;
}

/** What the player sees on the sign once they arrive at a shop that is not open yet. */
export const STOREFRONT_COMING_SOON_TEXT = 'Coming soon';

/** The hotspot's accessible name: the shop, and what pressing it does. */
export function storefrontAccessibleName(store: Pick<StorefrontHotspotConfig, 'name' | 'destination'>): string {
  return store.destination ? `${store.name}: go inside` : `${store.name}: coming soon`;
}

/** Is the shop open, does pressing its storefront lead somewhere? */
export function isStorefrontOpen(store: Pick<StorefrontHotspotConfig, 'destination'>): boolean {
  return store.destination !== null;
}
