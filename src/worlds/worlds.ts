/**
 * The places a Blobbi can travel to from the Island. Each is an independent
 * Blobbi application on its own origin; going there is a plain navigation of
 * this tab, through the egress boundary (`src/external-egress`), and nothing
 * travels with it: no key, no login, no session, no query string. The other
 * app signs the player in with its own sign-in, as it always has. The same
 * convention as Blobbi Home's `src/features/worlds/worlds.ts`.
 *
 * A world is OPEN only with an address that was checked to answer as that
 * app (HTTPS, the app's own page title), on the date below. A world without
 * a checked address is UPCOMING: shown, labelled, never a link.
 *
 * Checked 2026-10-19 with a plain HTTPS request:
 *   https://blobbi.pet/        → 200 (via www.blobbi.pet), "Blobbi - The home of your Blobbi"
 *   https://pixel.blobbi.pet/  → 200, "Blobbi Pixel"
 *   the Farm (`NOSTR_FARM_URL`, the Station's registry address, written there once) → 200, "Nostr Farm"
 *   https://rumble.blobbi.pet/ → 502: not open today (Blobbi Home had it answering
 *                                on 2026-10-12). Listed, labelled, never a link,
 *                                until a check finds it answering again.
 *
 * `travelId` is the World id the kit's World Travel protocol uses for the
 * same place (`WORLD_HOME`, `WORLD_PIXEL`; Farm's and Rumble's are the ids
 * the spec proposes, §11, registered here for their display names only). A
 * World id is a name, never an address: nothing navigates to it.
 */
import { WORLD_HOME, WORLD_PIXEL } from '@blobbi-kit/core';

import { NOSTR_FARM_URL } from '@/connected-experiences';

export type WorldId = 'home' | 'pixel' | 'farm' | 'rumble';

/** This World's id in the World Travel protocol. */
export const WORLD_ISLAND = 'blobbi-island';
export const WORLD_FARM = 'nostr-farm';
export const WORLD_RUMBLE = 'blobbi-rumble';

export interface World {
  id: WorldId;
  /** The World Travel id of the same place. */
  travelId: string;
  name: string;
  /** One line: what you do there. */
  tagline: string;
  /** The checked address, or null for a world that is not open yet. */
  url: string | null;
  /** The card's look: two colours of its sky. */
  colors: readonly [string, string];
  /** The card's emblem, shown when the icon cannot be (and beside a closed door). */
  emoji: string;
  /** The card's picture: that app's own icon, shipped with this app (public/icons/worlds/<travelId>.png). */
  icon: string;
}

/** Where a world's icon is kept in this app (each app's own 192 px icon, copied as it is). */
export const worldIconPath = (travelId: string) => `/icons/worlds/${travelId}.png`;

export const WORLDS_CHECKED_ON = '2026-10-19';

const DEFINED: readonly World[] = [
  { id: 'home', travelId: WORLD_HOME, name: 'Blobbi Home', tagline: 'Care for your Blobbi in its own home.', url: 'https://blobbi.pet/', colors: ['#fde68a', '#fdba74'], emoji: '🏠', icon: worldIconPath(WORLD_HOME) },
  { id: 'pixel', travelId: WORLD_PIXEL, name: 'Blobbi Pixel', tagline: 'A pixel adventure with your Blobbi.', url: 'https://pixel.blobbi.pet/', colors: ['#c4b5fd', '#f9a8d4'], emoji: '🕹️', icon: worldIconPath(WORLD_PIXEL) },
  { id: 'farm', travelId: WORLD_FARM, name: 'Nostr Farm', tagline: 'Grow crops and bring the harvest back.', url: NOSTR_FARM_URL, colors: ['#86efac', '#bef264'], emoji: '🌾', icon: worldIconPath(WORLD_FARM) },
  { id: 'rumble', travelId: WORLD_RUMBLE, name: 'Blobbi Rumble', tagline: 'A playful arena for friendly matches.', url: null, colors: ['#fca5a5', '#fdba74'], emoji: '🥊', icon: worldIconPath(WORLD_RUMBLE) },
];

/** An address a world may be opened at: absolute https, no credentials. */
export function isTravelUrl(candidate: string | null | undefined): candidate is string {
  if (!candidate) return false;
  try {
    const url = new URL(candidate);
    if (url.username || url.password) return false;
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export type WorldUrlOverrides = Readonly<Partial<Record<WorldId, string>>>;

/** `home` becomes `VITE_BLOBBI_WORLD_URL_HOME`. */
export function worldUrlEnvName(id: WorldId): string {
  return `VITE_BLOBBI_WORLD_URL_${id.toUpperCase()}`;
}

/**
 * Per-world destination overrides, for pointing a build at a local or staging
 * deployment without touching the registry: `VITE_BLOBBI_WORLD_URL_<ID>`. An
 * override that is not a travel address is ignored (the registry's stands).
 */
export function worldUrlOverrides(
  env: Readonly<Record<string, string | undefined>> = import.meta.env as Readonly<Record<string, string | undefined>>,
): WorldUrlOverrides {
  const overrides: Partial<Record<WorldId, string>> = {};
  for (const world of DEFINED) {
    const value = env[worldUrlEnvName(world.id)]?.trim();
    if (isTravelUrl(value)) overrides[world.id] = value;
  }
  return overrides;
}

export type OpenWorld = World & { open: boolean };

/** Every world, each with whether it can be travelled to now. */
export function worlds(overrides: WorldUrlOverrides = worldUrlOverrides()): readonly OpenWorld[] {
  return DEFINED.map((w) => {
    const url = overrides[w.id] ?? w.url;
    return { ...w, url, open: isTravelUrl(url) };
  });
}

export function worldById(id: WorldId, overrides?: WorldUrlOverrides): OpenWorld | undefined {
  return worlds(overrides).find((w) => w.id === id);
}

/** The world a World Travel id names, when it is one of ours. */
export function worldByTravelId(travelId: string, overrides?: WorldUrlOverrides): OpenWorld | undefined {
  return worlds(overrides).find((w) => w.travelId === travelId);
}
