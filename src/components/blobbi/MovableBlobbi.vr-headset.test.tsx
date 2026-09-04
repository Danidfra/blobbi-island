/**
 * The Nostr Station VR headset on the LOCAL actor.
 *
 * The headset is a consequence of the seated pose (`seatedAccessory` on
 * `resolveActorRender`), rendered by `SeatedAccessoryLayer` inside the actor's
 * scale rig at the face anchor. It is presentation only: these tests pin that
 * it appears in a Station VR chair, nowhere else, vanishes on standing, and
 * that putting it on writes nothing: no equipment mutation, no Nostr publish,
 * no accessory placement in the renderer's equipment layers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { TestApp } from '@/test/TestApp';
import { MovableBlobbi, type MovableBlobbiRef } from './MovableBlobbi';
import { locationBoundaries } from '@/lib/location-boundaries';
import { ADULT_FACE_LINE_PERCENT, blobbiFaceAnchor, VR_HEADSET_SRC, VR_HEADSET_WIDTH_PERCENT } from '@/lib/blobbi-actor-anchors';

const publishMutate = vi.fn();
const equipmentMutate = vi.fn();

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutate: publishMutate, mutateAsync: publishMutate, isPending: false }),
}));
vi.mock('@/placement/useEquipmentMutation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/placement/useEquipmentMutation')>();
  return {
    ...actual,
    useEquipmentMutation: () => ({ mutate: equipmentMutate, mutateAsync: equipmentMutate, isPending: false }),
  };
});

const DEV_VISUAL = {
  stage: 'baby' as const,
  baseColor: '#8E6BE8',
  secondaryColor: '#B79CF2',
  eyeColor: '#3A2A1A',
  name: 'TestBlobbi',
};

const CONTAINER_RECT = {
  width: 1046, height: 697, x: 0, y: 0, top: 0, left: 0, right: 1046, bottom: 697,
  toJSON: () => ({}),
} as DOMRect;

const MUSHIE_VISUAL = { ...DEV_VISUAL, stage: 'adult' as const, adultType: 'mushie' };

/** Mirrors PlayingView's pose controller: one `sittingIn`, cleared by any movement start. */
function Harness({ initialSeat = null as string | null, visual = DEV_VISUAL as typeof DEV_VISUAL | typeof MUSHIE_VISUAL }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobbiRef = useRef<MovableBlobbiRef>(null);
  const [sittingIn, setSittingIn] = useState<string | null>(initialSeat);

  return (
    <div ref={containerRef} data-testid="world" data-world-surface>
      <button type="button" data-testid="sit-station-1" onClick={() => setSittingIn('nostr-station-chair-1')}>sit station 1</button>
      <button type="button" data-testid="sit-station-4" onClick={() => setSittingIn('nostr-station-chair-4')}>sit station 4</button>
      <button type="button" data-testid="sit-mall" onClick={() => setSittingIn('mall-terrace-1-left-chair')}>sit mall</button>
      <button type="button" data-testid="stand" onClick={() => setSittingIn(null)}>stand</button>
      <MovableBlobbi
        ref={blobbiRef}
        containerRef={containerRef}
        anchorId="my-blobbi-anchor"
        initialPosition={{ x: 50, y: 90 }}
        boundary={locationBoundaries['nostr-station-inside.png']}
        backgroundFile="nostr-station-inside.png"
        size="lg"
        scaleByYPosition
        visualOverride={visual}
        pose={sittingIn ? { kind: 'seated', seatId: sittingIn } : { kind: 'standing' }}
        onMoveStart={() => setSittingIn(null)}
        onBlobbiClick={() => {}}
      />
    </div>
  );
}

async function setup(initialSeat: string | null = null, visual = DEV_VISUAL as typeof DEV_VISUAL | typeof MUSHIE_VISUAL) {
  const { container } = render(
    <TestApp>
      <Harness initialSeat={initialSeat} visual={visual} />
    </TestApp>,
  );
  const world = await screen.findByTestId('world');
  vi.spyOn(world, 'getBoundingClientRect').mockReturnValue(CONTAINER_RECT);
  const anchor = () => container.querySelector('#my-blobbi-anchor') as HTMLElement;
  return {
    container,
    anchor,
    headset: () => anchor().querySelector('[data-seated-accessory="vr-headset"]') as HTMLImageElement | null,
    equipmentPlacements: () => anchor().querySelectorAll('[data-accessory-code]'),
    click: (id: string) => act(() => screen.getByTestId(id).click()),
    clickWorld: (x: number, y: number) =>
      act(() => {
        world.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, button: 0 }));
      }),
  };
}

beforeEach(() => {
  publishMutate.mockClear();
  equipmentMutate.mockClear();
});

describe('VR headset while seated in a Nostr Station chair', () => {
  it('is absent while standing', async () => {
    const h = await setup();
    expect(h.headset()).toBeNull();
  });

  it('appears on sitting, inside the scale rig at the face anchor', async () => {
    const h = await setup();
    h.click('sit-station-1');
    const headset = h.headset();
    expect(headset).not.toBeNull();
    expect(headset!.getAttribute('src')).toBe(VR_HEADSET_SRC);
    // Follows the body: positioned in renderer-box percent, inside the rig
    // that carries depth × seat scale, never in room coordinates.
    const face = blobbiFaceAnchor(DEV_VISUAL);
    expect(headset!.style.left).toBe(`${face.x}%`);
    expect(headset!.style.top).toBe(`${face.y}%`);
    expect(headset!.style.width).toBe(`${VR_HEADSET_WIDTH_PERCENT}%`);
    expect(headset!.style.transform).toBe('translate(-50%, -50%)');
    expect(headset!.closest('[data-blobbi-scale-rig]')).not.toBeNull();
    // Over the face: painted after the body inside the same layer.
    const layer = headset!.closest('[data-seated-accessory-layer]')!;
    const body = layer.querySelector('[data-blobbi-renderer]')!;
    expect(body.compareDocumentPosition(headset!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(headset!.getAttribute('aria-hidden')).toBe('true');
    expect(h.anchor().dataset.seatedIn).toBe('nostr-station-chair-1');
  });

  it('sits on the eye line of the body that is actually drawn (the mushroom wears it low)', async () => {
    const h = await setup('nostr-station-chair-1', MUSHIE_VISUAL);
    const headset = h.headset();
    expect(headset).not.toBeNull();
    expect(headset!.style.top).toBe(`${ADULT_FACE_LINE_PERCENT.mushie}%`);
    expect(ADULT_FACE_LINE_PERCENT.mushie).toBeGreaterThan(blobbiFaceAnchor(DEV_VISUAL).y);
  });

  it('every Station chair puts it on the same way', async () => {
    const h = await setup();
    h.click('sit-station-4');
    expect(h.headset()).not.toBeNull();
    expect(h.anchor().dataset.seatedIn).toBe('nostr-station-chair-4');
  });

  it('is absent in a non-VR chair', async () => {
    const h = await setup('mall-terrace-1-left-chair');
    expect(h.anchor().dataset.seatedIn).toBe('mall-terrace-1-left-chair');
    expect(h.headset()).toBeNull();
  });

  it('is removed the moment the Blobbi stands (explicit stand)', async () => {
    const h = await setup('nostr-station-chair-2');
    expect(h.headset()).not.toBeNull();
    h.click('stand');
    expect(h.headset()).toBeNull();
    expect(h.anchor().dataset.seatedIn).toBeUndefined();
  });

  it('is removed the moment the Blobbi walks away (a world tap stands it up)', async () => {
    const h = await setup('nostr-station-chair-3');
    expect(h.headset()).not.toBeNull();
    h.clickWorld(523, 640);
    expect(h.headset()).toBeNull();
  });

  it('writes nothing: no equipment mutation, no publish, no accessory placement', async () => {
    const h = await setup();
    h.click('sit-station-1');
    expect(h.headset()).not.toBeNull();
    h.click('stand');
    h.click('sit-station-4');
    h.click('stand');
    expect(equipmentMutate).not.toHaveBeenCalled();
    expect(publishMutate).not.toHaveBeenCalled();
    expect(h.equipmentPlacements()).toHaveLength(0);
  });
});
