/**
 * The world-lighting overlay: one low-alpha colour veil over the whole scene.
 *
 * ## Why there is only one, and why it sits above the players
 *
 * The heavy half of the time-of-day grade is *not* here; it is a CSS `filter` on
 * the location artwork itself (see `PlaceBackground`). That split is forced by the
 * artwork being transparent exactly where the sky shows through: a tint layer
 * placed under the world content would darken the sky along with the ground and
 * wash the stars out, because a sibling overlay cannot follow another element's
 * alpha channel. A filter can; it leaves transparent pixels transparent.
 *
 * What is left for this layer is the part that *should* reach characters: a shared
 * warm or cool cast, so the Blobbi does not read as a daylight cut-out pasted onto
 * a night scene. Sitting above the world content is the only placement that
 * reliably beats the world's dense internal z-index range (see
 * `docs/audits/day-night-sky-audit.md` §5) without auditing thirty call sites.
 *
 * ## The readability budget
 *
 * Because it is above the content, this veil also covers remote players, name
 * labels, walk-up prompts and chat bubbles. So its alpha is capped low: 0.14 at
 * deep night before per-location scaling, which is a contrast decision, not a
 * taste one. At that weight a white chat bubble keeps ~86% of its luminance and
 * every interactive silhouette stays legible, while the artwork filter (which
 * cannot touch characters at all) carries the actual sense of night.
 *
 * Decorative throughout: `pointer-events: none`, `aria-hidden`, no
 * `data-world-surface`, no children.
 */

import { cn } from '@/lib/utils';
import { hexToRgba } from '@/lib/island-sky';
import { getLocationSkyConfig } from '@/lib/island-sky-locations';
import { useIslandSkyState, useIslandSkyTransitionMs } from '@/hooks/useIslandSky';
import type { LocationId } from '@/lib/location-types';

interface IslandWorldLightProps {
  location: LocationId;
  className?: string;
}

export function IslandWorldLight({ location, className }: IslandWorldLightProps) {
  const sky = useIslandSkyState();
  const transitionMs = useIslandSkyTransitionMs();

  const config = getLocationSkyConfig(location);
  if (!config.enabled) return null;

  const alpha = sky.worldLightOpacity * config.worldLightStrength;

  return (
    <div
      aria-hidden
      className={cn('absolute inset-0 pointer-events-none', className)}
      style={{
        // `background-color` interpolates natively, so colour and weight both ride
        // the same transition without needing `@property` support.
        backgroundColor: hexToRgba(sky.worldLightColor, alpha),
        transition: `background-color ${transitionMs}ms linear`,
      }}
    />
  );
}
