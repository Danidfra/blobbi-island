/**
 * Development/test accessory fixtures: THREE tiny local SVGs and the plain
 * data that places them.
 *
 * These exist because verifying the renderer's accessory pipeline should not
 * require an authenticated session, a relay, an inventory event, or a
 * production item definition. They are:
 *
 *  - never published to Nostr;
 *  - never inserted into anyone's inventory;
 *  - never implicitly equipped;
 *  - passed explicitly, as plain data, by whoever renders them.
 *
 * They are real IMAGE files rather than emoji or text on purpose: the renderer
 * paints accessories through `<img src>`, so an image fixture exercises the
 * production path: the candidate-source list, the `onError` fallback walk, the
 * transform stack: where a text glyph would exercise none of it.
 *
 * Between them the three cover every rendering behavior worth checking:
 *
 * | fixture      | slot       | exercises                                  |
 * | ------------ | ---------- | ------------------------------------------ |
 * | `cape`       | `back`     | behind-body layer, flipX, rear-view SURVIVAL |
 * | `goggles`    | `eyewear`  | front layer, rotation, rear-view HIDING    |
 * | `starBadge`  | `headwear` | front layer, scale, x/y placement          |
 */
import type { AccessoryPlacementInput } from '@blobbi/react';

/** Resolved against this module, so the URLs are real and bundler-agnostic. */
const fixtureUrl = (file: string) => new URL(`./${file}`, import.meta.url).href;

export const FIXTURE_IMAGE_URLS = {
  cape: fixtureUrl('cape.svg'),
  goggles: fixtureUrl('goggles.svg'),
  starBadge: fixtureUrl('star-badge.svg'),
} as const;

/** A cape: behind the body, mirrored, low and centered. */
export const FIXTURE_CAPE: AccessoryPlacementInput = {
  code: 'back-devcape',
  slot: 'back',
  x: 50,
  y: 62,
  scale: 1.4,
  rot: 0,
  flipX: true,
  url: FIXTURE_IMAGE_URLS.cape,
};

/** Goggles: on the face, so they must vanish in rear view. Rotated. */
export const FIXTURE_GOGGLES: AccessoryPlacementInput = {
  code: 'eyewear-devgoggles',
  slot: 'eyewear',
  x: 50,
  y: 44,
  scale: 0.85,
  rot: -12,
  flipX: false,
  url: FIXTURE_IMAGE_URLS.goggles,
};

/** A badge worn on the head: front layer, off-center, scaled down. */
export const FIXTURE_STAR_BADGE: AccessoryPlacementInput = {
  code: 'headwear-devstar',
  slot: 'headwear',
  x: 62,
  y: 21,
  scale: 0.6,
  rot: 15,
  flipX: false,
  url: FIXTURE_IMAGE_URLS.starBadge,
};

/** The full set, for "several accessories at once" cases. */
export const FIXTURE_ACCESSORIES: readonly AccessoryPlacementInput[] = [
  FIXTURE_CAPE,
  FIXTURE_GOGGLES,
  FIXTURE_STAR_BADGE,
];

/**
 * A fixture whose primary URL is guaranteed to fail, followed by one that
 * works: for exercising the renderer's candidate-source fallback walk.
 */
export const FIXTURE_BROKEN_PRIMARY: AccessoryPlacementInput = {
  ...FIXTURE_STAR_BADGE,
  code: 'headwear-devbroken',
  url: 'https://invalid.invalid/does-not-exist.png',
};

/** The resolver a consumer would supply for {@link FIXTURE_BROKEN_PRIMARY}. */
export const fixtureSourceResolver = ({ code, url }: { code: string; url?: string }) =>
  [url, code === 'headwear-devbroken' ? FIXTURE_IMAGE_URLS.starBadge : undefined].filter(
    (candidate): candidate is string => !!candidate,
  );
