import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { MovableBlobbi } from './MovableBlobbi';
import { useRef } from 'react';

// Mock the CurrentBlobbiDisplay component
vi.mock('./CurrentBlobbiDisplay', () => ({
  CurrentBlobbiDisplay: () => <div data-testid="blobbi-display">Blobbi</div>,
}));

// Mock the calculateBlobbiZIndex function
vi.mock('@/lib/interactive-elements-config', () => ({
  calculateBlobbiZIndex: () => 20,
}));

function TestWrapper({ scaleByYPosition = false, backgroundFile = 'nostr-station-open.png' }) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <TestApp>
      <div ref={containerRef} style={{ width: '400px', height: '300px' }}>
        <MovableBlobbi
          containerRef={containerRef}
          scaleByYPosition={scaleByYPosition}
          backgroundFile={backgroundFile}
          initialPosition={{ x: 50, y: 75 }}
          boundary={{ shape: 'rectangle', x: [0, 100], y: [60, 100] }}
        />
      </div>
    </TestApp>
  );
}

describe('MovableBlobbi', () => {
  // Since the gaze refactor, the OUTER wrapper only translates (anchor for
  // bubbles); the dynamic scale lives on the INNER wrapper. Query that one.
  // (Attribute selectors with "(" break jsdom's selector engine, so filter
  // by regex instead.)
  const getScaleElement = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>('[style]')).find((el) =>
      /(?:^|\s)transform:\s*scale\([\d.]+\)/.test(el.getAttribute('style') ?? '')
    ) ?? null;

  it('renders without scaling when scaleByYPosition is false', () => {
    const { container } = render(<TestWrapper scaleByYPosition={false} />);

    const blobbiElement = getScaleElement(container);
    expect(blobbiElement).toBeTruthy();

    // Should have scale(1) when scaling is disabled
    const style = blobbiElement?.getAttribute('style');
    expect(style).toContain('scale(1)');
  });

  it('applies scaling for approved backgrounds', () => {
    const { container: nostrStationContainer } = render(
      <TestWrapper
        scaleByYPosition={true}
        backgroundFile="nostr-station-open.png"
      />
    );
    const nostrStationBlobbi = getScaleElement(nostrStationContainer);
    expect(nostrStationBlobbi?.getAttribute('style')).not.toContain('scale(1)');

    const { container: townContainer } = render(
      <TestWrapper
        scaleByYPosition={true}
        backgroundFile="town-open.png"
      />
    );
    const townBlobbi = getScaleElement(townContainer);
    expect(townBlobbi?.getAttribute('style')).not.toContain('scale(1)');

    const { container: plazaContainer } = render(
      <TestWrapper
        scaleByYPosition={true}
        backgroundFile="plaza-open.png"
      />
    );
    const plazaBlobbi = getScaleElement(plazaContainer);
    expect(plazaBlobbi?.getAttribute('style')).not.toContain('scale(1)');
  });

  it('applies correct scaling for nostr-station background', () => {
    const { container } = render(
      <TestWrapper
        scaleByYPosition={true}
        backgroundFile="nostr-station-open.png"
      />
    );

    const blobbiElement = getScaleElement(container);
    const style = blobbiElement?.getAttribute('style');
    const scaleMatch = style?.match(/scale\(([\d.]+)\)/);
    const scaleValue = scaleMatch ? parseFloat(scaleMatch[1]) : 0;

    expect(scaleValue).toBeGreaterThanOrEqual(0.6);
    expect(scaleValue).toBeLessThanOrEqual(1.2);
  });

  it('applies correct scaling for town background', () => {
    const { container } = render(
      <TestWrapper
        scaleByYPosition={true}
        backgroundFile="town-open.png"
      />
    );

    const blobbiElement = getScaleElement(container);
    const style = blobbiElement?.getAttribute('style');
    const scaleMatch = style?.match(/scale\(([\d.]+)\)/);
    const scaleValue = scaleMatch ? parseFloat(scaleMatch[1]) : 0;

    expect(scaleValue).toBeGreaterThanOrEqual(0.7);
    expect(scaleValue).toBeLessThanOrEqual(1.2);
  });

  it('applies correct scaling for plaza background', () => {
    const { container } = render(
      <TestWrapper
        scaleByYPosition={true}
        backgroundFile="plaza-open.png"
      />
    );

    const blobbiElement = getScaleElement(container);
    const style = blobbiElement?.getAttribute('style');
    const scaleMatch = style?.match(/scale\(([\d.]+)\)/);
    const scaleValue = scaleMatch ? parseFloat(scaleMatch[1]) : 0;

    expect(scaleValue).toBeGreaterThanOrEqual(0.8);
    expect(scaleValue).toBeLessThanOrEqual(1.2);
  });

  it('properly positions and scales the shadow', () => {
    const { container } = render(
      <TestWrapper
        scaleByYPosition={true}
        backgroundFile="nostr-station-open.png"
      />
    );

    // Find the shadow element (has radial-gradient background)
    const shadowElement = container.querySelector('[style*="radial-gradient"]');
    expect(shadowElement).toBeTruthy();

    // Shadow should be centered (translateX) and scaled with the Blobbi
    const shadowStyle = shadowElement?.getAttribute('style');
    expect(shadowStyle).toContain('translateX(-50%)');
    expect(shadowStyle).toMatch(/scale\([\d.]+\)/);

    // Shadow should have transform-origin set to center
    expect(shadowStyle).toContain('transform-origin: center center');
  });

  it('renders the Blobbi display component', () => {
    const { getByTestId } = render(<TestWrapper />);

    expect(getByTestId('blobbi-display')).toBeInTheDocument();
  });
});