/**
 * DevBlobbiEffects — the visual-effect harness (dev-only route
 * `/dev/blobbi-effects`; excluded from production builds like the other
 * `/dev/*` pages).
 *
 * WHAT IT DRIVES. `BlobbiRendererView` directly, with a hand-written visual and
 * a literal `effects` array. There is no login, no signer, no relay, no query
 * client, no inventory, no equip state and no `CurrentBlobbiDisplay` — which is
 * the point: if drawing an effect ever needed any of those, this page would
 * stop rendering, and that failure is the test.
 *
 * WHAT IT DOES NOT DO. It publishes nothing, mutates no inventory, grants
 * nothing and never touches the player's Blobbi. The trusted item registry is
 * displayed as reference data (`d` tag, rarity, address) and is not used to
 * activate anything — activation is a later phase.
 *
 * REDUCED MOTION is simulated with CSS rather than by patching `matchMedia`,
 * because the package's reduced-motion support IS a `@media` block: there is no
 * JavaScript to fool. The override below repeats that block's two declarations
 * verbatim under a scoping attribute, so what the toggle shows is what a user
 * with the OS setting on actually sees.
 */
import { useMemo, useState } from 'react';
import {
  BlobbiRendererView,
  BLOBBI_VISUAL_EFFECT_IDS,
  getBlobbiVisualEffectInfo,
  type BlobbiRenderSize,
  type BlobbiRenderVisual,
  type BlobbiVisualEffectId,
} from '@blobbi/react';
import { ADDRESSED_VISUAL_EFFECT_ITEMS } from '@/effects/official-visual-effect-items';
import { locationBackgroundPath } from '@/lib/asset-paths';

const ADULT_FORMS = [
  'bloomi', 'breezy', 'cacti', 'catti', 'cloudi', 'crysti', 'droppi', 'flammi',
  'froggi', 'leafy', 'mushie', 'owli', 'pandi', 'rocky', 'rosey', 'starri',
] as const;

const BASE_VISUAL = {
  baseColor: '#8E6BE8',
  secondaryColor: '#B79CF2',
  eyeColor: '#3A2A1A',
  name: 'FX Blobbi',
};

/**
 * Backgrounds chosen to break the two things effects are most likely to get
 * wrong: a dark aura on a dark room, and a pale particle on a bright one.
 */
const BACKGROUNDS = [
  { id: 'light', label: 'Light', css: 'linear-gradient(180deg,#FFF4D8,#FBEAC2)' },
  { id: 'dark', label: 'Dark room', css: 'linear-gradient(180deg,#2A2340,#141020)' },
  { id: 'night', label: 'Night', css: 'linear-gradient(180deg,#16213E,#0B1020)' },
  { id: 'grass', label: 'Grass', css: 'linear-gradient(180deg,#9DDCF9,#7CCB72)' },
  { id: 'white', label: 'White', css: '#ffffff' },
  {
    id: 'room',
    label: 'Real room',
    css: `center / cover no-repeat url(${locationBackgroundPath('home-inside.png')})`,
  },
] as const;

type BackgroundId = (typeof BACKGROUNDS)[number]['id'];

const SIZES: BlobbiRenderSize[] = ['sm', 'md', 'lg', 'xl', '2xl', '3xl'];

const REGISTRY_BY_EFFECT = new Map(
  ADDRESSED_VISUAL_EFFECT_ITEMS.map((item) => [item.effectId, item]),
);

/**
 * The reduced-motion simulation.
 *
 * Two declarations, copied from the package's own `@media
 * (prefers-reduced-motion: reduce)` block. Scoped to an attribute so the rest
 * of the page keeps animating and the two states can be compared side by side.
 */
function ReducedMotionOverride() {
  return (
    <style>{`
[data-fx-reduced="true"] .blobbi-fx-track,
[data-fx-reduced="true"] .blobbi-fx-piece {
  animation: none !important;
  transform: none !important;
}
`}</style>
  );
}

interface StageProps {
  effects?: BlobbiVisualEffectId[];
  visual: BlobbiRenderVisual;
  instanceId: string;
  size: BlobbiRenderSize;
  facing: 'front' | 'back';
  background: BackgroundId;
  reduced: boolean;
  /** Draw the effects with no Blobbi under them. */
  effectOnly?: boolean;
  className?: string;
}

/** One framed renderer on a chosen background. */
function Stage({
  effects,
  visual,
  instanceId,
  size,
  facing,
  background,
  reduced,
  effectOnly = false,
  className,
}: StageProps) {
  const bg = BACKGROUNDS.find((b) => b.id === background)!;
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-lg border border-black/20 ${className ?? ''}`}
      style={{ background: bg.css }}
      data-fx-reduced={reduced ? 'true' : 'false'}
      data-fx-stage={instanceId}
    >
      <BlobbiRendererView
        visual={visual}
        instanceId={instanceId}
        size={size}
        facing={facing}
        effects={effects?.map((id) => ({ id }))}
      />
      {effectOnly && (
        // The body is hidden rather than unmounted: effects are positioned
        // against the renderer box, so removing the renderer would move every
        // one of them and the "effect only" view would be a different picture.
        <style>{`
[data-fx-stage="${instanceId}"] [data-blobbi-body-box] { opacity: 0; }
`}</style>
      )}
    </div>
  );
}

export function DevBlobbiEffects() {
  const [stage, setStage] = useState<'baby' | 'adult'>('baby');
  const [adultType, setAdultType] = useState<string>('catti');
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [background, setBackground] = useState<BackgroundId>('light');
  const [reduced, setReduced] = useState(false);
  const [effectOnly, setEffectOnly] = useState(false);
  const [selected, setSelected] = useState<BlobbiVisualEffectId>('golden-sparkles');
  const [focusSize, setFocusSize] = useState<BlobbiRenderSize>('3xl');

  const visual: BlobbiRenderVisual = useMemo(
    () => ({ ...BASE_VISUAL, stage, adultType: stage === 'adult' ? adultType : undefined }),
    [stage, adultType],
  );

  const selectedInfo = getBlobbiVisualEffectInfo(selected);
  const selectedItem = REGISTRY_BY_EFFECT.get(selected);

  const stageProps = { visual, size: 'xl' as BlobbiRenderSize, facing, background, reduced, effectOnly };

  return (
    <div className="min-h-screen bg-neutral-900 p-4 text-neutral-100">
      <ReducedMotionOverride />

      <header className="mb-4">
        <h1 className="text-xl font-semibold">Blobbi visual effects — dev harness</h1>
        <p className="text-xs text-neutral-400">
          Renders <code>BlobbiRendererView</code> directly from plain data. No login, no relay,
          no inventory, no publishing. Nothing here activates or grants anything.
        </p>
      </header>

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg bg-neutral-800 p-3 text-sm">
        <label className="flex items-center gap-2">
          Stage
          <select
            className="rounded bg-neutral-700 px-2 py-1"
            value={stage}
            onChange={(e) => setStage(e.target.value as 'baby' | 'adult')}
          >
            <option value="baby">baby</option>
            <option value="adult">adult</option>
          </select>
        </label>

        <label className="flex items-center gap-2">
          Adult form
          <select
            className="rounded bg-neutral-700 px-2 py-1 disabled:opacity-40"
            value={adultType}
            disabled={stage !== 'adult'}
            onChange={(e) => setAdultType(e.target.value)}
          >
            {ADULT_FORMS.map((form) => (
              <option key={form} value={form}>{form}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          Facing
          <select
            className="rounded bg-neutral-700 px-2 py-1"
            value={facing}
            onChange={(e) => setFacing(e.target.value as 'front' | 'back')}
          >
            <option value="front">front</option>
            <option value="back">back</option>
          </select>
        </label>

        <label className="flex items-center gap-2">
          Background
          <select
            className="rounded bg-neutral-700 px-2 py-1"
            value={background}
            onChange={(e) => setBackground(e.target.value as BackgroundId)}
          >
            {BACKGROUNDS.map((bg) => (
              <option key={bg.id} value={bg.id}>{bg.label}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} />
          Simulate prefers-reduced-motion
        </label>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={effectOnly} onChange={(e) => setEffectOnly(e.target.checked)} />
          Effect only (hide body)
        </label>
      </div>

      {/* ── Focused preview of the selected effect ───────────────────────── */}
      <section className="mb-8 rounded-lg bg-neutral-800 p-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h2 className="text-lg font-semibold">{selectedInfo.displayName}</h2>
          <code className="text-xs text-emerald-300">{selectedInfo.id}</code>
          <span className="text-xs uppercase text-amber-300">{selectedItem?.rarity}</span>
          <span className="text-xs text-neutral-400">slot: {selectedInfo.slot}</span>
          <span className="text-xs text-neutral-400">{selectedInfo.pieceCount} pieces</span>
          <label className="ml-auto flex items-center gap-2 text-sm">
            Size
            <select
              className="rounded bg-neutral-700 px-2 py-1"
              value={focusSize}
              onChange={(e) => setFocusSize(e.target.value as BlobbiRenderSize)}
            >
              {SIZES.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="mb-3 max-w-3xl text-sm text-neutral-300">{selectedInfo.description}</p>
        <p className="mb-4 text-[11px] text-neutral-500">
          Planned item: <code>{selectedItem?.d}</code> — address{' '}
          <code className="break-all">{selectedItem?.address}</code> (identity only; not published)
        </p>

        <div className="flex flex-wrap gap-4">
          {/* Side-by-side baseline comparison — the reference for "did this
              change anything it should not have?" */}
          <figure>
            <Stage {...stageProps} size={focusSize} effects={undefined} instanceId="focus-none" className="h-80 w-80" />
            <figcaption className="mt-1 text-center text-xs text-neutral-400">no effect</figcaption>
          </figure>
          <figure>
            <Stage {...stageProps} size={focusSize} effects={[selected]} instanceId="focus-fx" className="h-80 w-80" />
            <figcaption className="mt-1 text-center text-xs text-neutral-400">{selected}</figcaption>
          </figure>
          {/* Two simultaneous instances, same effect: proves the scatters are
              independent and that nothing is shared between them. */}
          <figure>
            <div className="flex h-80 gap-2">
              <Stage {...stageProps} size={focusSize} effects={[selected]} instanceId="pair-a" className="w-40" />
              <Stage {...stageProps} size={focusSize} effects={[selected]} instanceId="pair-b" className="w-40" />
            </div>
            <figcaption className="mt-1 text-center text-xs text-neutral-400">
              two instances (isolation)
            </figcaption>
          </figure>
        </div>

        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-300">Every renderer size</h3>
          <div className="flex flex-wrap items-end gap-3">
            {SIZES.map((size) => (
              <figure key={size}>
                <Stage
                  {...stageProps}
                  size={size}
                  effects={[selected]}
                  instanceId={`size-${size}`}
                  className="h-72 w-72"
                />
                <figcaption className="mt-1 text-center text-xs text-neutral-400">{size}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ── The whole catalogue ──────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">All twelve effects</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {BLOBBI_VISUAL_EFFECT_IDS.map((id) => {
            const info = getBlobbiVisualEffectInfo(id);
            const item = REGISTRY_BY_EFFECT.get(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelected(id)}
                className={`rounded-lg bg-neutral-800 p-3 text-left transition ${
                  selected === id ? 'ring-2 ring-emerald-400' : 'hover:bg-neutral-700'
                }`}
              >
                <Stage
                  {...stageProps}
                  effects={[id]}
                  instanceId={`card-${id}`}
                  className="mb-2 h-56 w-full"
                />
                <div className="text-sm font-semibold">{info.displayName}</div>
                <code className="text-[11px] text-emerald-300">{info.id}</code>
                <div className="mt-1 flex gap-2 text-[11px]">
                  <span className="uppercase text-amber-300">{item?.rarity}</span>
                  <span className="text-neutral-400">{info.slot}</span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-neutral-400">{info.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Slot conflict demo ───────────────────────────────────────────── */}
      <section className="mb-8 rounded-lg bg-neutral-800 p-4">
        <h2 className="mb-1 text-lg font-semibold">Slot behaviour</h2>
        <p className="mb-3 text-xs text-neutral-400">
          One effect per slot. When several compete, the FIRST in the supplied order wins — so
          the two conflict cards below differ only in the order they were asked for.
        </p>
        <div className="flex flex-wrap gap-4">
          <figure>
            <Stage
              {...stageProps}
              effects={['celestial-aura', 'mystic-fog', 'golden-sparkles', 'pixel-glitch']}
              instanceId="combo-legal"
              className="h-72 w-72"
            />
            <figcaption className="mt-1 w-72 text-center text-xs text-neutral-400">
              four different slots — all four render
            </figcaption>
          </figure>
          <figure>
            <Stage
              {...stageProps}
              effects={['solar-radiance', 'void-whispers', 'rainbow-dream', 'celestial-aura']}
              instanceId="combo-conflict-a"
              className="h-72 w-72"
            />
            <figcaption className="mt-1 w-72 text-center text-xs text-neutral-400">
              four auras — solar-radiance wins (first)
            </figcaption>
          </figure>
          <figure>
            <Stage
              {...stageProps}
              effects={['void-whispers', 'solar-radiance', 'rainbow-dream', 'celestial-aura']}
              instanceId="combo-conflict-b"
              className="h-72 w-72"
            />
            <figcaption className="mt-1 w-72 text-center text-xs text-neutral-400">
              same four, reordered — void-whispers wins
            </figcaption>
          </figure>
          <figure>
            <Stage
              {...stageProps}
              effects={[...BLOBBI_VISUAL_EFFECT_IDS]}
              instanceId="combo-all"
              className="h-72 w-72"
            />
            <figcaption className="mt-1 w-72 text-center text-xs text-neutral-400">
              all twelve asked for — four drawn
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── Motion comparison ────────────────────────────────────────────── */}
      <section className="rounded-lg bg-neutral-800 p-4">
        <h2 className="mb-1 text-lg font-semibold">Reduced motion, side by side</h2>
        <p className="mb-3 text-xs text-neutral-400">
          Right-hand stage has the package's reduced-motion declarations forced on. Every effect
          must stay visible and legible with all animation removed.
        </p>
        <div className="flex flex-wrap gap-4">
          <figure>
            <Stage {...stageProps} reduced={false} effects={[selected]} instanceId="rm-off" className="h-72 w-72" />
            <figcaption className="mt-1 w-72 text-center text-xs text-neutral-400">animated</figcaption>
          </figure>
          <figure>
            <Stage {...stageProps} reduced effects={[selected]} instanceId="rm-on" className="h-72 w-72" />
            <figcaption className="mt-1 w-72 text-center text-xs text-neutral-400">reduced motion</figcaption>
          </figure>
        </div>
      </section>
    </div>
  );
}

export default DevBlobbiEffects;
