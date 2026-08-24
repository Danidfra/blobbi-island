/**
 * DEV-only harness for the day/night sky.
 *
 * ## Production safety
 *
 * `isSkyDevMode` is `import.meta.env.DEV`, which Vite replaces with a literal
 * `false` in a build, so the whole component body collapses to an early `return
 * null` and the surrounding branch in `PlaceBackground` is dead code the bundler
 * drops. The guard is *not* CSS — nothing is rendered and then hidden. Even if
 * this component were somehow mounted in production, `setIslandSkyDev` is itself
 * guarded, so every control would be inert and the sky would stay on the
 * automatic clock.
 *
 * ## Why it is not a `/dev/sky` route
 *
 * `src/dev-routes.test.ts` asserts that exactly two dev routes exist
 * (`/dev/theater`, `/dev/arcade`); adding a third would fail it. More
 * importantly, a route would have to rebuild the world shell to show a sky, which
 * would be testing a replica. This panel opens *over the real world* from the
 * existing "Developer tools" section of `AccountMenu`, so what is being adjusted
 * is the actual scene, with the actual Blobbi and actual remote players in it —
 * which is the only way to judge whether the night is too dark to play in.
 *
 * It is mounted outside `VirtualWorld` because it is UI rather than a world
 * object; inside the scaled layer it would shrink with the viewport.
 */

import { Fragment } from 'react';

import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ISLAND_DAY_MINUTES } from '@/lib/island-clock';
import { type IslandDayPhase } from '@/lib/island-sky';
import {
  islandSkyDevCloudOverride,
  islandSkyDevFreezeOverride,
  islandSkyDevPhaseOverride,
  isSkyDevMode,
  resetIslandSkyDev,
  setIslandSkyDev,
  useIslandSkyDev,
} from '@/lib/island-sky-dev';
import { ISLAND_CLOUD_ACTORS } from '@/lib/island-sky-clouds';
import {
  ISLAND_CLOUD_SHAPES,
  ISLAND_CLOUD_SIZES,
  type IslandCloudShape,
} from '@/lib/island-sky-cloud-shapes';
import { WORLD_WIDTH } from '@/lib/world-coordinates';
import { getLocationSkyConfig, skyEnabledLocations } from '@/lib/island-sky-locations';
import {
  useIslandClockState,
  useIslandCloudPassages,
  useIslandSkyState,
} from '@/hooks/useIslandSky';
import { useLocation } from '@/hooks/useLocation';
import { useReducedMotion } from '@/hooks/useReducedMotion';

const PHASES: readonly IslandDayPhase[] = ['dawn', 'day', 'sunset', 'night'];

/**
 * Human label for a shape id.
 *
 * Derived here rather than stored on the geometry table, because the table is
 * production data and the labels are DEV-only chrome — keeping them in this module
 * means they are dropped from the production bundle along with the panel.
 */
function cloudShapeLabel(shape: IslandCloudShape): string {
  return shape
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/** `mm:ss` of the island day, so a scrubbed position is a readable number. */
function formatIslandTime(minute: number): string {
  const whole = Math.floor(minute);
  const seconds = Math.floor((minute - whole) * 60);
  return `${String(whole).padStart(3, '0')}:${String(seconds).padStart(2, '0')}`;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-block-move
      className={[
        'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'bg-island-cream-2 text-island-ink hover:bg-island-sand',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function IslandSkyDevPanel() {
  const dev = useIslandSkyDev();
  const auto = useIslandClockState();
  const sky = useIslandSkyState();
  const { currentLocation, setCurrentLocation } = useLocation();
  const osReducedMotion = useReducedMotion();
  const passages = useIslandCloudPassages(WORLD_WIDTH);

  if (!isSkyDevMode || !dev.panelOpen) return null;

  const config = getLocationSkyConfig(currentLocation);
  const locations = skyEnabledLocations();

  return (
    <div
      data-block-move
      // `left`/`top` rather than the bottom edge, so the panel never fights the
      // action dock for the same corner. `data-block-move` on the panel and on
      // every control keeps a stray tap from becoming a walk order.
      className="pointer-events-auto absolute left-2 top-16 z-40 max-h-[calc(100%-5rem)] w-60 space-y-2.5 overflow-y-auto rounded-2xl border border-island-wood/30 bg-island-cream/95 p-3 text-island-ink shadow-cozy-raised backdrop-blur-sm sm:top-20"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide">Sky</p>
        <button
          type="button"
          onClick={() => setIslandSkyDev({ panelOpen: false })}
          aria-label="Close sky dev panel"
          data-block-move
          className="rounded-full px-1.5 text-sm text-island-ink-soft hover:text-island-ink"
        >
          ✕
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] leading-snug">
        <dt className="text-island-ink-soft">Phase</dt>
        <dd className="font-semibold">
          {sky.phase}
          {sky.inFinalTransition ? ' → dawn' : ''}
        </dd>
        <dt className="text-island-ink-soft">Island time</dt>
        <dd className="font-mono">{formatIslandTime(sky.minute)}</dd>
        <dt className="text-island-ink-soft">Phase progress</dt>
        <dd className="font-mono">{(sky.phaseProgress * 100).toFixed(0)}%</dd>
        <dt className="text-island-ink-soft">Clock</dt>
        <dd className="font-semibold">{dev.mode === 'auto' ? 'auto' : 'held'}</dd>
      </dl>

      <div className="flex flex-wrap gap-1.5">
        <Chip active={dev.mode === 'auto'} onClick={resetIslandSkyDev}>
          Auto
        </Chip>
        <Chip
          active={dev.mode === 'fixed'}
          onClick={() => setIslandSkyDev(islandSkyDevFreezeOverride(auto.dayProgress, dev))}
        >
          Freeze
        </Chip>
        {PHASES.map((phase) => (
          <Chip
            key={phase}
            active={dev.mode === 'fixed' && sky.phase === phase}
            onClick={() => setIslandSkyDev(islandSkyDevPhaseOverride(phase, dev))}
          >
            {phase}
          </Chip>
        ))}
      </div>

      <div className="space-y-1">
        <label className="flex items-baseline justify-between text-[11px] text-island-ink-soft">
          <span>Day progress</span>
          <span className="font-mono">{(sky.dayProgress * 100).toFixed(1)}%</span>
        </label>
        <Slider
          value={[sky.dayProgress * ISLAND_DAY_MINUTES]}
          min={0}
          max={ISLAND_DAY_MINUTES}
          step={0.25}
          aria-label="Island day progress in minutes"
          onValueChange={([minutes]) =>
            setIslandSkyDev({ mode: 'fixed', dayProgress: minutes / ISLAND_DAY_MINUTES })
          }
        />
      </div>

      <label className="flex items-center justify-between gap-2 text-[11px]">
        <span>Clouds</span>
        <Switch
          checked={dev.cloudsEnabled}
          onCheckedChange={(checked) => setIslandSkyDev({ cloudsEnabled: checked })}
          aria-label="Toggle sky clouds"
        />
      </label>

      <label className="flex items-center justify-between gap-2 text-[11px]">
        <span>
          Reduced motion
          {osReducedMotion && <span className="ml-1 text-island-ink-soft">(OS: on)</span>}
        </span>
        <Switch
          checked={dev.simulateReducedMotion || osReducedMotion}
          disabled={osReducedMotion}
          onCheckedChange={(checked) => setIslandSkyDev({ simulateReducedMotion: checked })}
          aria-label="Simulate reduced motion"
        />
      </label>

      {/*
        Cloud preview. Every silhouette and size is reachable in two clicks; a
        production passage would take up to thirteen minutes to come round, and a
        given formation appears roughly once in twenty passages, so waiting for one
        is not an inspection strategy.

        Picking a concrete shape or size also switches placement to `preview`
        (`islandSkyDevCloudOverride`), which parks the selected actor centred in the
        sky and hides the other two so the outline can be judged on its own.
      */}
      <div className="space-y-1 border-t border-island-wood/20 pt-2">
        <div className="flex items-baseline justify-between text-[11px] text-island-ink-soft">
          <span>Cloud preview</span>
          {dev.cloudPlacement === 'preview' && (
            <span className="font-semibold text-island-purple">parked</span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ISLAND_CLOUD_ACTORS.map((actor) => (
            <Chip
              key={actor.id}
              active={dev.cloudActorId === actor.id}
              onClick={() =>
                setIslandSkyDev(islandSkyDevCloudOverride({ cloudActorId: actor.id }, dev))
              }
            >
              {actor.id.replace('cloud-', '').toUpperCase()}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Chip
            active={dev.cloudShape === 'auto'}
            onClick={() => setIslandSkyDev(islandSkyDevCloudOverride({ cloudShape: 'auto' }, dev))}
          >
            Auto
          </Chip>
          {ISLAND_CLOUD_SHAPES.map((shape) => (
            <Chip
              key={shape}
              active={dev.cloudShape === shape}
              onClick={() => setIslandSkyDev(islandSkyDevCloudOverride({ cloudShape: shape }, dev))}
            >
              {cloudShapeLabel(shape)}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Chip
            active={dev.cloudSize === 'auto'}
            onClick={() => setIslandSkyDev(islandSkyDevCloudOverride({ cloudSize: 'auto' }, dev))}
          >
            Auto
          </Chip>
          {ISLAND_CLOUD_SIZES.map((size) => (
            <Chip
              key={size}
              active={dev.cloudSize === size}
              onClick={() => setIslandSkyDev(islandSkyDevCloudOverride({ cloudSize: size }, dev))}
            >
              {size}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Chip
            active={dev.cloudPlacement === 'auto'}
            onClick={() =>
              setIslandSkyDev(islandSkyDevCloudOverride({ cloudPlacement: 'auto' }, dev))
            }
          >
            Automatic
          </Chip>
          <Chip
            active={dev.cloudPlacement === 'preview'}
            onClick={() =>
              setIslandSkyDev(islandSkyDevCloudOverride({ cloudPlacement: 'preview' }, dev))
            }
          >
            Preview
          </Chip>
        </div>

        {/* What production would be showing right now, so a forced variant can be
            compared against the real policy without turning the override off. */}
        <dl className="grid grid-cols-2 gap-x-2 text-[10px] leading-snug text-island-ink-soft">
          {passages.map(({ actor, passage }) => (
            <Fragment key={actor.id}>
              <dt>{actor.id.replace('cloud-', '')}</dt>
              <dd className="font-mono">
                {passage.shape === 'normal' ? passage.size : `${passage.shape} ${passage.size}`}
              </dd>
            </Fragment>
          ))}
        </dl>
      </div>

      <div className="space-y-1 border-t border-island-wood/20 pt-2">
        <p className="text-[11px] text-island-ink-soft">
          Sky locations
          {!config.enabled && <span className="ml-1">— current scene has no sky</span>}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {locations.map((id) => (
            <Fragment key={id}>
              <Chip active={id === currentLocation} onClick={() => setCurrentLocation(id)}>
                {id}
                {/* A dot marks scenes whose artwork has not had its sky cut out
                    yet, so an invisible sky is never mistaken for a broken one. */}
                {!getLocationSkyConfig(id).artworkSkyReady && (
                  <span className="ml-1 opacity-60" title="artwork sky not transparent yet">
                    ○
                  </span>
                )}
              </Chip>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
