/**
 * The ground shadow and the float, as the body reports them: the shadow sits
 * on the drawing's measured ground line, as wide as its footprint, behind the
 * body and inside the scale rig; the body's own drop shadow never shades the
 * ellipse or the label; a baby floats over a breathing shadow while an adult
 * stands on a still one; local and remote bodies place it alike; seated
 * hides it, hidden draws nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { useMemo } from 'react';
import { render } from '@testing-library/react';
import { BlobbiRenderer } from '@blobbi-kit/renderer';

import { CharacterEquipmentContext } from '@/contexts/CharacterEquipmentContext';
import { devV3Visual } from '@/lib/dev-v3-fixture';
import { resolveGroundShadow } from '@/lib/blobbi-ground-shadow';
import { stageFloats } from '@/lib/blobbi-stage-motion';
import { useReportActorArtwork } from './actor-artwork-context';

vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({ useBlobbonautProfile: () => ({ data: null }) }));
const { BlobbiActor } = await import('./BlobbiActor');
const { CurrentBlobbiDisplay } = await import('./CurrentBlobbiDisplay');

const V1_ADULT = { stage: 'adult' as const, visualGeneration: 'v1' as const, adultType: 'bloomi', baseColor: '#4F46E5', secondaryColor: '#7C3AED', eyeColor: '#1F2937', name: 'Probe' };
const V1_BABY = { ...V1_ADULT, stage: 'baby' as const, adultType: undefined };

const equipment = { accessories: [], effects: [], activeEffects: [], rejectedEffects: [], definitionsByAddress: new Map(), hidden: [], warnings: [], isLoading: false, isEmpty: true };

function renderLocal(visual: Parameters<typeof CurrentBlobbiDisplay>[0]['visualOverride'], props: Partial<React.ComponentProps<typeof BlobbiActor>> = {}) {
  return render(
    <CharacterEquipmentContext.Provider value={equipment}>
      <BlobbiActor position={{ x: 50, y: 80 }} size="lg" scale={0.8} zIndex={10} {...props}>
        <CurrentBlobbiDisplay idSuffix="shadow" visualOverride={visual} />
      </BlobbiActor>
    </CharacterEquipmentContext.Provider>,
  );
}

const shadowOf = (c: HTMLElement) => c.querySelector('[data-blobbi-shadow]') as HTMLElement | null;
const bodyOf = (c: HTMLElement) => c.querySelector('[data-blobbi-body]') as HTMLElement;
const pct = (v: string) => Number(v.replace('%', ''));

describe('the ground shadow under a body', () => {
  it('sits on the measured ground line, under the measured footprint, for a V1 adult (whose feet are above the box bottom)', () => {
    const { container } = renderLocal(V1_ADULT);
    const g = resolveGroundShadow(V1_ADULT, 'front');
    const shadow = shadowOf(container)!;
    expect(pct(shadow.style.top)).toBeCloseTo(g.groundY * 100, 3);
    expect(pct(shadow.style.left)).toBeCloseTo(g.centerX * 100, 3);
    expect(pct(shadow.style.width)).toBeCloseTo(g.width * 100, 3);
    expect(pct(shadow.style.top)).toBeLessThan(90);
    expect(shadow.style.transform).toBe('translate(-50%, -50%)');
  });

  it('a V3 adult stands on its own footprint; a different form, a different shadow', () => {
    const v3 = renderLocal(devV3Visual('adult'));
    const g = resolveGroundShadow(devV3Visual('adult'), 'front');
    expect(pct(shadowOf(v3.container)!.style.top)).toBeCloseTo(g.groundY * 100, 3);
    expect(pct(shadowOf(v3.container)!.style.width)).toBeCloseTo(g.width * 100, 3);
    const v1 = renderLocal(V1_ADULT);
    expect(shadowOf(v1.container)!.style.top).not.toBe(shadowOf(v3.container)!.style.top);
  });

  it('is first in paint order (behind the body), inside the scale rig, outside the float wrapper', () => {
    const { container } = renderLocal(V1_ADULT);
    const shadow = shadowOf(container)!;
    const rig = container.querySelector('[data-blobbi-scale-rig]')!;
    const body = bodyOf(container);
    expect(shadow.parentElement).toBe(rig);
    expect(shadow.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body.contains(shadow)).toBe(false);
    expect(container.querySelector('[data-blobbi-renderer]')!.contains(shadow)).toBe(false);
  });

  it('the body\'s drop shadow is on the body wrapper, not on the anchor: it never shades the ellipse or a label', () => {
    const { container } = renderLocal(V1_ADULT, { labelSlot: <div data-testid="label">Probe</div> });
    const anchor = container.querySelector('[data-blobbi-actor]') as HTMLElement;
    expect(anchor.style.filter).toBe('');
    expect(bodyOf(container).style.filter).toContain('drop-shadow');
    expect(shadowOf(container)!.style.filter).toBe('');
    expect(bodyOf(container).contains(container.querySelector('[data-testid="label"]'))).toBe(false);
  });

  it('a baby floats over a shadow that breathes in step; an adult stands on a still one and never floats', () => {
    const baby = renderLocal(V1_BABY);
    expect(bodyOf(baby.container).classList.contains('animate-float')).toBe(true);
    expect(bodyOf(baby.container).dataset.blobbiFloats).toBe('true');
    expect(shadowOf(baby.container)!.classList.contains('animate-shadow-float')).toBe(true);

    for (const adult of [V1_ADULT, devV3Visual('adult')]) {
      const { container } = renderLocal(adult);
      expect(bodyOf(container).classList.contains('animate-float')).toBe(false);
      expect(bodyOf(container).dataset.blobbiFloats).toBe('false');
      expect(shadowOf(container)!.classList.contains('animate-shadow-float')).toBe(false);
    }
  });

  it('a pose that forbids the float (seated, sleeping) stops a baby bobbing too; seated hides the shadow', () => {
    const asleep = renderLocal(V1_BABY, { disableFloat: true });
    expect(bodyOf(asleep.container).classList.contains('animate-float')).toBe(false);
    expect(shadowOf(asleep.container)!.classList.contains('animate-shadow-float')).toBe(false);
    const seated = renderLocal(V1_BABY, { hideShadow: true, disableFloat: true });
    expect(shadowOf(seated.container)).toBeNull();
  });

  it('the pure renderer alone (a remote body) places the shadow exactly as the local display does', () => {
    const local = renderLocal(devV3Visual('adult'));
    const { container } = render(
      <BlobbiActor position={{ x: 50, y: 80 }} size="lg" scale={0.8} zIndex={10}>
        <RemoteBody />
      </BlobbiActor>,
    );
    expect(shadowOf(container)!.getAttribute('style')).toBe(shadowOf(local.container)!.getAttribute('style'));
  });

  it('draws no shadow at all while the actor is visually hidden', () => {
    const { container } = renderLocal(V1_ADULT, { visualHidden: true, hiddenIn: 'bush' });
    expect(shadowOf(container)).toBeNull();
    expect(container.querySelector('[data-blobbi-body]')).toBeNull();
  });
});

/** The remote sprite's report, in miniature: the same two lines `RemoteBlobbiSprite` runs. */
function RemoteBody() {
  const visual = devV3Visual('adult');
  return <ReportingRenderer visual={visual} />;
}

function ReportingRenderer({ visual }: { visual: ReturnType<typeof devV3Visual> }) {
  const report = useMemo(() => ({ shadow: resolveGroundShadow(visual, 'front'), floats: stageFloats(visual) }), [visual]);
  useReportActorArtwork(report);
  return <BlobbiRenderer visual={visual} instanceId="remote" size="lg" />;
}
