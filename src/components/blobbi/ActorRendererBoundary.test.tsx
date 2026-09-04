/**
 * The seam between the WORLD ACTOR and the PURE RENDERER (Phase 4).
 *
 * The split only pays off if it holds in both directions:
 *
 *  - the renderer must produce identical output wherever it is mounted, so it
 *    cannot be quietly depending on being inside a world; and
 *  - every world concern, position, depth scale, z-index, ground shadow, the
 *    float bob: must stay in `BlobbiActor`, so the renderer stays portable.
 *
 * The third claim here is the local/remote one: both wrappers derive their
 * visual flags from the SAME pure resolver (`resolveActorRender`), so a seated
 * or hidden Blobbi can never be drawn one way by its owner and another way by
 * everyone else.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BlobbiActor } from './BlobbiActor';
import { BlobbiRendererView } from '@blobbi/react';
import { resolveActorRender, type BlobbiActorPose } from '@/lib/blobbi-pose';

const VISUAL = {
  stage: 'baby' as const,
  baseColor: '#ff6699',
  secondaryColor: '#66ccff',
  eyeColor: '#222222',
};

const rendererHtml = (container: HTMLElement) =>
  (container.querySelector('[data-blobbi-renderer]') as HTMLElement).outerHTML;

describe('the renderer renders identically inside and outside a world actor', () => {
  it('produces byte-identical markup bare and wrapped in BlobbiActor', () => {
    const bare = render(<BlobbiRendererView visual={VISUAL} instanceId="parity" size="xl" />);

    const wrapped = render(
      <BlobbiActor
        position={{ x: 37.5, y: 82 }}
        size="xl"
        scale={0.63}
        zIndex={41}
        seatedIn="theater-seat-r2-3"
      >
        <BlobbiRendererView visual={VISUAL} instanceId="parity" size="xl" />
      </BlobbiActor>,
    );

    // The actor moved, scaled, stacked and seated it, and none of that reached
    // the renderer's own DOM.
    expect(rendererHtml(wrapped.container)).toBe(rendererHtml(bare.container));
  });

  it('keeps world transforms strictly outside the renderer box', () => {
    const { container } = render(
      <BlobbiActor position={{ x: 20, y: 90 }} size="lg" scale={0.5} zIndex={12}>
        <BlobbiRendererView visual={VISUAL} instanceId="outside" size="lg" />
      </BlobbiActor>,
    );

    const anchor = container.querySelector('[data-blobbi-actor]') as HTMLElement;
    const rig = container.querySelector('[data-blobbi-scale-rig]') as HTMLElement;
    const shadow = container.querySelector('[data-blobbi-shadow]');
    const box = container.querySelector('[data-blobbi-renderer]') as HTMLElement;

    // Position, z-index and the ground anchor live on the actor.
    expect(anchor.style.left).toBe('20%');
    expect(anchor.style.zIndex).toBe('12');
    expect(anchor.style.transform).toBe('translate(-50%, -100%)');
    // Depth scale lives on the rig, the shadow beside it; never on the box.
    expect(rig.style.transform).toBe('scale(0.5)');
    expect(shadow).not.toBeNull();
    expect(box.style.transform).toBe('');
    expect(box.style.zIndex).toBe('');
    expect(box.contains(shadow)).toBe(false);
  });

  it('renders nothing of the Blobbi while the actor is visually hidden', () => {
    const { container } = render(
      <BlobbiActor
        position={{ x: 50, y: 50 }} size="lg" scale={1} zIndex={1}
        hiddenIn="town-bush-1" visualHidden
      >
        <BlobbiRendererView visual={VISUAL} instanceId="hidden" size="lg" />
      </BlobbiActor>,
    );

    // The positioned anchor survives (chat bubbles portal into it); the sprite
    // and its shadow do not exist in the DOM at all.
    expect(container.querySelector('[data-blobbi-actor]')).not.toBeNull();
    expect(container.querySelector('[data-blobbi-renderer]')).toBeNull();
    expect(container.querySelector('[data-blobbi-shadow]')).toBeNull();
  });
});

describe('local and remote actors derive the same visual flags', () => {
  const ctx = {
    groundPosition: { x: 44, y: 78 },
    backgroundFile: undefined,
    boundary: undefined,
    scaleByYPosition: false,
  };

  it.each([
    ['hidden', { kind: 'hidden', spotId: 'town-bush-1' } as BlobbiActorPose],
    ['seated', { kind: 'seated', seatId: 'theater-seat-r1-1' } as BlobbiActorPose],
    ['sleeping', { kind: 'sleeping', anchor: { x: 44, y: 78 } } as BlobbiActorPose],
    ['standing', { kind: 'standing' } as BlobbiActorPose],
  ])('the %s pose resolves to one answer, whoever is asking', (_label, pose) => {
    // "Local" and "remote" differ only in how they OBTAIN the pose (own state
    // vs. presence fields). Given the same pose they must agree on every
    // visual consequence: that is the whole point of the shared resolver.
    expect(resolveActorRender(pose, ctx)).toEqual(resolveActorRender(pose, ctx));
  });

  it('a hidden pose is the ONLY thing that sets visualHidden', () => {
    const hidden = resolveActorRender({ kind: 'hidden', spotId: 'town-bush-1' }, ctx);
    expect(hidden.visualHidden).toBe(true);
    expect(hidden.hiddenIn).toBe('town-bush-1');

    for (const pose of [
      { kind: 'standing' } as BlobbiActorPose,
      { kind: 'sleeping', anchor: { x: 44, y: 78 } } as BlobbiActorPose,
      { kind: 'seated', seatId: 'theater-seat-r1-1' } as BlobbiActorPose,
    ]) {
      expect(resolveActorRender(pose, ctx).visualHidden).toBe(false);
    }
  });

  it('both wrappers read hidden-ness from the resolver, not from raw state', () => {
    // Phase 3 left the remote layer reading `!!player.hiddenIn` directly while
    // the local one already read the resolved flag. Same answer today, but two
    // sources for one decision is exactly how they drift apart later.
    for (const wrapper of ['MovableBlobbi.tsx', 'MultiplayerLayer.tsx']) {
      const source = readFileSync(join(process.cwd(), 'src/components/blobbi', wrapper), 'utf8');
      expect(source, `${wrapper} must pass the resolved flag`).toMatch(
        /visualHidden=\{render\.visualHidden\}/,
      );
    }
  });
});
