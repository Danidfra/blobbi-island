/**
 * "What would this EFFECT look like on an actual Blobbi?"
 *
 * The effect-item counterpart to `BlobbiAccessoryPreview`, and it exists for a
 * blunt reason: an effect item's artwork is a token — a star charm, a mist
 * bottle, a prism — that represents the effect in an inventory row. Pasting
 * that token onto a Blobbi's head, which is what the accessory preview would
 * do, shows something the game will never draw. The effect is what the item
 * grants, so the effect is what gets previewed.
 *
 * ## Nothing here activates anything
 *
 * The Blobbi is a fixture (shared with the accessory preview so the two tabs
 * agree). Nothing is equipped, owned, granted or published, and the item's
 * address is never consulted — the preview draws the effect id the author
 * typed, precisely BECAUSE that is not how the game decides. In the game an
 * effect runs only when a trusted item address resolves to it
 * (`src/effects/official-visual-effect-items.ts`); here the author is asking
 * "what does this id look like?", which is a different question and needs no
 * trust at all.
 *
 * ## An unimplemented id gets a labelled stand-in, never a blank box
 *
 * `@blobbi/react` draws twelve effects. An id outside that set is a valid thing
 * to publish — another client may know it — but this client cannot draw it, and
 * an empty preview reads as a broken item rather than an unimplemented one.
 *
 * So an unknown id borrows a real effect from its declared `effectSlot` and is
 * labelled unmistakably as an approximation (`resolveEffectPreview`). The two
 * things the author can act on — where it will sit, and that THIS client draws
 * nothing for it — are both stated. What is never done is pretending the
 * stand-in is the item's own effect.
 */

import { useState } from 'react';

import {
  BlobbiRendererView,
  getBlobbiVisualEffectInfo,
  type BlobbiRenderSize,
  type BlobbiVisualEffectId,
} from '@blobbi/react';
import { Badge } from '@/components/ui/badge';

import { PREVIEW_VISUALS } from '@/tools/game-items/preview-model';

import { ToggleRow } from './BlobbiAccessoryPreview';
import {
  DEFAULT_PLACEHOLDER_SLOT,
  isPlaceholderSlot,
  resolveEffectPreview,
  slotForEffectId,
} from './effect-vocabulary';

export interface BlobbiEffectPreviewProps {
  /** The item's `visual.effect`, exactly as typed. */
  effect: string;
  /** The item's `visual.effectSlot`, exactly as typed. */
  effectSlot: string;
}

export function BlobbiEffectPreview({ effect, effectSlot }: BlobbiEffectPreviewProps) {
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [stage, setStage] = useState<'baby' | 'adult'>('baby');
  const [size, setSize] = useState<BlobbiRenderSize>('2xl');

  const trimmed = effect.trim();
  const declaredSlot = effectSlot.trim();

  // ONE resolver, for every source: an imported draft, a loaded event, an
  // autosaved draft and live typing all arrive here as the same two strings.
  const resolved = resolveEffectPreview(trimmed, declaredSlot);
  const known = resolved.kind === 'implemented';
  const info =
    resolved.renderId !== null
      ? getBlobbiVisualEffectInfo(resolved.renderId as BlobbiVisualEffectId)
      : null;
  const actualSlot = slotForEffectId(trimmed);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleRow
          label="Facing"
          value={facing}
          options={[
            ['front', 'Front'],
            ['back', 'Back'],
          ]}
          onChange={(value) => setFacing(value as 'front' | 'back')}
        />
        <ToggleRow
          label="Stage"
          value={stage}
          options={[
            ['baby', 'Baby'],
            ['adult', 'Adult'],
          ]}
          onChange={(value) => setStage(value as 'baby' | 'adult')}
        />
        <ToggleRow
          label="Size"
          value={size}
          options={[
            ['lg', 'lg'],
            ['xl', 'xl'],
            ['2xl', '2xl'],
            ['3xl', '3xl'],
          ]}
          onChange={(value) => setSize(value as BlobbiRenderSize)}
        />
      </div>

      <div
        className="flex min-h-72 items-center justify-center overflow-hidden rounded-xl border"
        style={{ background: 'linear-gradient(180deg,#2A2340,#141020)' }}
        data-effect-preview-stage=""
        data-effect-preview-kind={resolved.kind}
        data-effect-preview-rendering={resolved.renderId ?? ''}
      >
        <BlobbiRendererView
          visual={PREVIEW_VISUALS[stage]}
          instanceId="item-studio-effect-preview"
          size={size}
          facing={facing}
          // The one and only input: a plain id. No CSS, no markup, no component
          // name, and nothing read out of the event being authored.
          effects={
            resolved.renderId === null
              ? undefined
              : [{ id: resolved.renderId as BlobbiVisualEffectId }]
          }
        />
      </div>

      <div className="space-y-1.5 text-[11px] text-muted-foreground">
        {resolved.kind === 'none' ? (
          <p>
            No <code>visual.effect</code> yet. Name the effect this item grants — or
            just its <code>effectSlot</code> — and it will be drawn here.
          </p>
        ) : known ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="font-mono text-[10px]">
                {trimmed}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                slot: {actualSlot}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {info!.pieceCount} particles
              </Badge>
            </div>
            <p>{info!.description}</p>
            {declaredSlot !== '' && declaredSlot !== actualSlot && (
              <p className="text-destructive">
                This definition declares <code>effectSlot: {declaredSlot}</code>, but
                the effect occupies <code>{actualSlot}</code> in this client.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className="bg-amber-500 text-[10px] text-amber-950 hover:bg-amber-500">
                Approximate preview
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                slot: {resolved.placeholderSlot}
              </Badge>
            </div>
            <p>
              {trimmed === '' ? (
                <>
                  No <code>visual.effect</code> named yet.
                </>
              ) : (
                <>
                  <code>{trimmed}</code> is not an effect this client implements, so
                  Blobbi Island would draw nothing for it — that is still valid to
                  publish, and a newer client may know it.
                </>
              )}{' '}
              Shown above is a generic <code>{resolved.placeholderSlot}</code> effect,
              so you can see WHERE this one would sit. It is a stand-in, not this
              item&rsquo;s artwork.
              {declaredSlot !== '' && !isPlaceholderSlot(declaredSlot) && (
                  <>
                    {' '}
                    <code>{declaredSlot}</code> is not one of the four effect slots,
                    so the stand-in falls back to{' '}
                    <code>{DEFAULT_PLACEHOLDER_SLOT}</code>.
                  </>
                )}
            </p>
          </>
        )}
        <p>
          A preview only. Publishing this item grants nobody the effect, and the
          effect runs in the game only for a trusted item address.
        </p>
      </div>
    </div>
  );
}
