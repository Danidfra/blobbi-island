import type { LocationId } from '@/lib/location-types';

/**
 * Which map destination a location belongs to.
 *
 * The map shows the six places a player travels BETWEEN; the rest of the
 * Island (arcade floors, the stage, the shops and their interiors, the cave,
 * the yard) is reached from one of them. A player standing in the arcade is,
 * on this map, in Town, so that is where "You are here" goes. Nothing here
 * expands the map; it only tells the truth about where the player is on it.
 */
const MAP_DESTINATION_OF: Partial<Record<LocationId, LocationId>> = {
  arcade: 'town',
  'arcade-1': 'town',
  'arcade-minus1': 'town',
  stage: 'town',
  shop: 'town',
  'clothing-store-inside': 'town',
  'care-store-inside': 'town',
  'badges-store-inside': 'town',
  'furniture-store-inside': 'town',
  'nostr-station-inside': 'nostr-station',
  'plaza-inside': 'plaza',
  'cave-open': 'mine',
  'back-yard': 'home',
};

/** The marker that stands for a location on this map, or the location itself. */
export function mapDestinationFor(location: LocationId): LocationId {
  return MAP_DESTINATION_OF[location] ?? location;
}
