/**
 * What a build says about World Travel, checked when Vite starts
 * (`vite.config.ts`), so a configuration mistake fails loudly instead of
 * compiling World Travel off without a word. No imports: the Vite config
 * loads it in Node. The same check as Blobbi Home's `travel-build.ts`.
 *
 *   VITE_BLOBBI_WORLD_TRAVEL   unset, empty or `off`: off (the default).
 *                              `nostr`: World Travel on Nostr. Anything else
 *                              is a mistake (`on`, `true`, a typo) and stops
 *                              the build.
 *
 * World Travel signs and publishes the Blobbi's World Location (kind 31126,
 * experimental) to the public travel relays. The page still decides at run
 * time (`travel-mode.ts`, the same rule); this only makes the build's intent
 * explicit, and says so when it is on.
 */
export type TravelBuildCheck = { ok: true; on: boolean; message: string | null } | { ok: false; message: string };

const TRAVEL_VALUES = ['', 'off', 'nostr'];

export function checkTravelBuild(o: { travel?: string; command: 'build' | 'serve' }): TravelBuildCheck {
  // Exactly as the page reads it (no trimming): what passes here is what turns it on there
  const travel = o.travel ?? '';
  if (!TRAVEL_VALUES.includes(travel)) {
    return { ok: false, message: `VITE_BLOBBI_WORLD_TRAVEL=${JSON.stringify(o.travel)} is not a value World Travel knows: leave it unset (off) or set it to "nostr".` };
  }
  if (travel !== 'nostr') return { ok: true, on: false, message: null };
  return {
    ok: true,
    on: true,
    message:
      o.command === 'build'
        ? 'World Travel: ON in this build. Moves are signed by the player and published to the public travel relays (kind 31126).'
        : 'World Travel: ON in this development server. Moves are signed and published to the PUBLIC travel relays unless a test guard redirects them.',
  };
}
