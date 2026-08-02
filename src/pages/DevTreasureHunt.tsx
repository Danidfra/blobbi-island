/**
 * /dev/treasure-hunt — the Beach Treasure Hunt harness (Beach 1B).
 *
 * SIMULATION ONLY. This page drives the pure seeded model
 * (`src/beach/treasure-hunt/`) and the real contained UI
 * (`TreasureHuntModal`) with dev overlays and forced policies. It is not a
 * production route, grants no session, signs nothing, publishes nothing,
 * and never touches Coins, inventory or profiles — the Phase 1B game has no
 * reward path at all, and this harness must keep proving that.
 *
 * The stage box below provides a `StageOverlayContext` host (the same
 * mechanism `BlobbiFrame` uses), so the shell portals into a bounded,
 * resizable "screen" — which is what makes the mobile viewport presets work.
 *
 * Forced-policy notes: every preset below still goes through
 * `validateTreasureHuntPolicy`. An invalid combination (e.g. a shovel
 * override of 0) is reported as a harness error rather than weakening the
 * production validation.
 */

import { useMemo, useState } from 'react';
import { StageOverlayContext } from '@/contexts/StageOverlayContext';
import { TreasureHuntModal } from '@/components/blobbi/beach/TreasureHuntModal';
import { TREASURE_HUNT_UI_POLICY } from '@/components/blobbi/beach/treasure-hunt-config';
import {
  validateTreasureHuntPolicy,
  type TreasureHuntPolicy,
} from '@/beach/treasure-hunt';

type CompositionPreset = 'default' | 'litter-only' | 'valuable-only' | 'force-special';
type ViewportPreset = 'fluid' | 'phone-landscape' | 'phone-portrait' | 'tablet';

const VIEWPORTS: Record<ViewportPreset, { label: string; width?: number; height?: number }> = {
  fluid: { label: 'Fluid (fill panel)' },
  'phone-landscape': { label: 'Phone landscape · 844×390', width: 844, height: 390 },
  'phone-portrait': { label: 'Phone portrait · 390×700', width: 390, height: 700 },
  tablet: { label: 'Tablet · 1024×720', width: 1024, height: 720 },
};

function buildPolicy(
  base: TreasureHuntPolicy,
  composition: CompositionPreset,
  shovelUses: number,
  unlimitedTime: boolean
): TreasureHuntPolicy {
  let categories = base.categories;
  if (composition === 'litter-only') {
    categories = {
      litter: { ...base.categories.litter, minCount: base.targetCount, maxCount: base.targetCount },
      valuable: { ...base.categories.valuable, minCount: 0, maxCount: 0 },
      special: { ...base.categories.special, minCount: 0, maxCount: 0 },
    };
  } else if (composition === 'valuable-only') {
    categories = {
      litter: { ...base.categories.litter, minCount: 0, maxCount: 0 },
      valuable: { ...base.categories.valuable, minCount: base.targetCount, maxCount: base.targetCount },
      special: { ...base.categories.special, minCount: 0, maxCount: 0 },
    };
  } else if (composition === 'force-special') {
    categories = {
      ...base.categories,
      special: { ...base.categories.special, minCount: 1, maxCount: 1 },
    };
  }
  const policy: TreasureHuntPolicy = {
    ...base,
    shovelUses,
    roundDurationSeconds: unlimitedTime ? 24 * 60 * 60 : base.roundDurationSeconds,
    categories,
  };
  validateTreasureHuntPolicy(policy); // throws → surfaced as a harness error
  return policy;
}

export function DevTreasureHunt() {
  const [seed, setSeed] = useState('dev-hunt-1');
  const [runKey, setRunKey] = useState(0);
  const [composition, setComposition] = useState<CompositionPreset>('default');
  const [shovelUses, setShovelUses] = useState(TREASURE_HUNT_UI_POLICY.shovelUses);
  const [unlimitedTime, setUnlimitedTime] = useState(false);
  const [revealTargets, setRevealTargets] = useState(true);
  const [showDetectionRadius, setShowDetectionRadius] = useState(true);
  const [showDigRadius, setShowDigRadius] = useState(true);
  const [showCoilAnchor, setShowCoilAnchor] = useState(true);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [forceReducedMotion, setForceReducedMotion] = useState(false);
  const [viewport, setViewport] = useState<ViewportPreset>('fluid');
  const [host, setHost] = useState<HTMLElement | null>(null);

  const policyResult = useMemo(() => {
    try {
      return {
        policy: buildPolicy(TREASURE_HUNT_UI_POLICY, composition, shovelUses, unlimitedTime),
        error: null as string | null,
      };
    } catch (error) {
      return {
        policy: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [composition, shovelUses, unlimitedTime]);

  const viewportBox = VIEWPORTS[viewport];

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <header className="mx-auto mb-3 max-w-5xl space-y-1">
        <h1 className="text-xl font-bold">Beach Treasure Hunt — dev harness</h1>
        <p
          className="inline-block rounded-full bg-amber-200 px-3 py-1 text-sm font-semibold"
          data-simulation-only
        >
          Simulation only — nothing is published, granted or saved.
        </p>
        <p className="text-xs text-slate-600">
          End reasons: let the timer run out (disable unlimited time), burn every shovel use,
          dig up every target, or use Leave for an ended-by-player round.
        </p>
      </header>

      <div className="mx-auto flex max-w-5xl flex-col gap-3 lg:flex-row">
        {/* Controls */}
        <aside className="w-full shrink-0 space-y-3 rounded-xl border border-slate-300 bg-white p-3 text-sm lg:w-72">
          <div className="space-y-1">
            <label className="block font-semibold" htmlFor="dev-seed">
              Seed
            </label>
            <input
              id="dev-seed"
              className="w-full rounded border border-slate-300 px-2 py-1"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
            />
            <button
              type="button"
              className="mt-1 rounded-full border border-slate-400 px-3 py-1 font-semibold"
              onClick={() => setRunKey((k) => k + 1)}
              data-dev-regenerate
            >
              Regenerate / Reset
            </button>
          </div>

          <div className="space-y-1">
            <label className="block font-semibold" htmlFor="dev-composition">
              Composition
            </label>
            <select
              id="dev-composition"
              className="w-full rounded border border-slate-300 px-2 py-1"
              value={composition}
              onChange={(event) => setComposition(event.target.value as CompositionPreset)}
            >
              <option value="default">Default policy</option>
              <option value="litter-only">Force litter-only</option>
              <option value="valuable-only">Force valuable-only</option>
              <option value="force-special">Force special candidate</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="block font-semibold" htmlFor="dev-shovel">
              Shovel uses
            </label>
            <input
              id="dev-shovel"
              type="number"
              min={1}
              max={99}
              className="w-24 rounded border border-slate-300 px-2 py-1"
              value={shovelUses}
              onChange={(event) => setShovelUses(Number(event.target.value))}
            />
          </div>

          {(
            [
              ['Unlimited time', unlimitedTime, setUnlimitedTime],
              ['Reveal hidden targets', revealTargets, setRevealTargets],
              ['Show detection radius', showDetectionRadius, setShowDetectionRadius],
              ['Show dig radius', showDigRadius, setShowDigRadius],
              ['Show coil anchor', showCoilAnchor, setShowCoilAnchor],
              ['Show coordinates', showCoordinates, setShowCoordinates],
              ['Force reduced motion', forceReducedMotion, setForceReducedMotion],
            ] as const
          ).map(([label, value, setValue]) => (
            <label key={label} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={value}
                onChange={(event) => setValue(event.target.checked)}
              />
              {label}
            </label>
          ))}

          <div className="space-y-1">
            <label className="block font-semibold" htmlFor="dev-viewport">
              Viewport
            </label>
            <select
              id="dev-viewport"
              className="w-full rounded border border-slate-300 px-2 py-1"
              value={viewport}
              onChange={(event) => setViewport(event.target.value as ViewportPreset)}
            >
              {Object.entries(VIEWPORTS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          <p className="text-xs text-slate-500">
            Mute, pause, resume and exit are the real in-game controls. Muting here is the
            shared arcade mute and persists.
          </p>

          {policyResult.error && (
            <p role="alert" className="rounded bg-red-100 p-2 text-xs text-red-800" data-dev-policy-error>
              Invalid forced policy: {policyResult.error}
            </p>
          )}
        </aside>

        {/* Stage — the shell portals into this box via StageOverlayContext. */}
        <main className="flex-1">
          <div
            className="relative mx-auto overflow-hidden rounded-xl border border-slate-300 bg-slate-800"
            style={
              viewportBox.width
                ? { width: viewportBox.width, height: viewportBox.height, maxWidth: '100%' }
                : { height: '75vh' }
            }
            data-dev-stage
          >
            <div
              ref={setHost}
              data-stage-overlay-host
              className="pointer-events-none absolute inset-0 z-40 [&>*]:pointer-events-auto"
            />
            {policyResult.policy && (
              <StageOverlayContext.Provider value={host}>
                <TreasureHuntModal
                  key={`${seed}:${runKey}:${composition}:${shovelUses}:${unlimitedTime}`}
                  open
                  onClose={() => {
                    /* Returning to the Beach has no meaning here; the modal
                       resets itself to the intro, which doubles as reset
                       without reload. */
                  }}
                  dev={{
                    seed,
                    policy: policyResult.policy,
                    forceReducedMotion: forceReducedMotion || undefined,
                    overlays: {
                      revealTargets,
                      showDetectionRadius,
                      showDigRadius,
                      showCoilAnchor,
                      showCoordinates,
                    },
                  }}
                />
              </StageOverlayContext.Provider>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
