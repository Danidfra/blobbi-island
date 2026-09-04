/**
 * The decision, and the browser call.
 *
 * The assertion that matters most is negative: a denied class must not reach
 * `window.open` or `navigator.share` at all. "The button was hidden" is not the
 * claim: a component that still holds the callback is one prop from being
 * reachable, and a modified build has it regardless.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FAMILY_POLICY, STANDARD_POLICY, type IslandSafetyPolicy } from '@/safety';

import { EGRESS_CAPABILITY, isEgressAllowed, type EgressClass } from './classes';
import { canNativeShare, decideEgress, performEgress, type EgressRequest } from './egress';
import { SOCIAL_SHARE_TARGETS } from './social';

const ORIGIN = 'https://island.example';

const PAYLOAD = { url: 'https://island.example/', text: '#Blobbi', hashtags: ['Blobbi'] } as const;

const ALL_CLASSES: readonly EgressClass[] = [
  'external-link',
  'social-share',
  'native-share',
  'relay-management',
  'authoring-tool',
];

let openSpy: ReturnType<typeof vi.fn>;
let shareSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openSpy = vi.fn();
  shareSpy = vi.fn(async () => {});
  vi.stubGlobal('open', openSpy);
  window.open = openSpy as unknown as typeof window.open;
  Object.defineProperty(navigator, 'share', { value: shareSpy, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Capability mapping ──────────────────────────────────────────────────────

describe('capability mapping', () => {
  it('gives every class exactly one capability', () => {
    for (const egressClass of ALL_CLASSES) {
      expect(EGRESS_CAPABILITY[egressClass]).toBeTruthy();
    }
    // No two classes share a capability: each is a distinct product decision.
    const capabilities = ALL_CLASSES.map((c) => EGRESS_CAPABILITY[c]);
    expect(new Set(capabilities).size).toBe(capabilities.length);
  });

  it('allows every class under Standard', () => {
    for (const egressClass of ALL_CLASSES) {
      expect(isEgressAllowed(STANDARD_POLICY, egressClass)).toBe(true);
    }
  });

  it('denies every class under Family', () => {
    for (const egressClass of ALL_CLASSES) {
      expect(isEgressAllowed(FAMILY_POLICY, egressClass)).toBe(false);
    }
  });

  it('follows the capability, never the profile name', () => {
    // A policy labelled 'family' whose capabilities are Standard's behaves as
    // Standard. If this fails, something started branching on identity.
    const mislabelled = { ...STANDARD_POLICY, profile: 'family' } as IslandSafetyPolicy;
    for (const egressClass of ALL_CLASSES) {
      expect(isEgressAllowed(mislabelled, egressClass)).toBe(true);
    }
  });
});

// ── Standard ────────────────────────────────────────────────────────────────

describe('Standard', () => {
  it('asks before opening a plain external link', () => {
    const decision = decideEgress(
      STANDARD_POLICY,
      { class: 'external-link', url: 'https://soapbox.pub/mkstack', label: 'MKStack' },
      ORIGIN,
    );
    expect(decision).toEqual({
      outcome: 'confirm',
      destination: {
        egressClass: 'external-link',
        host: 'soapbox.pub',
        url: 'https://soapbox.pub/mkstack',
        label: 'MKStack',
      },
    });
  });

  it.each(SOCIAL_SHARE_TARGETS.map((target) => [target.id, target.label] as const))(
    'builds and confirms a %s share',
    (platform, label) => {
      const decision = decideEgress(
        STANDARD_POLICY,
        { class: 'social-share', platform, payload: PAYLOAD },
        ORIGIN,
      );
      expect(decision.outcome).toBe('confirm');
      if (decision.outcome !== 'confirm') return;
      expect(decision.destination.label).toBe(label);
      expect(decision.destination.url.startsWith('https://')).toBe(true);
      // The payload is encoded, not concatenated raw.
      expect(decision.destination.url).toContain(encodeURIComponent(PAYLOAD.url));
    },
  );

  it('does not confirm a native share, the OS sheet is the confirmation', () => {
    const decision = decideEgress(
      STANDARD_POLICY,
      { class: 'native-share', data: { title: 'x' } },
      ORIGIN,
    );
    expect(decision).toEqual({ outcome: 'allowed', destination: null });
  });

  it('refuses an unknown platform', () => {
    const decision = decideEgress(
      STANDARD_POLICY,
      { class: 'social-share', platform: 'myspace' as never, payload: PAYLOAD },
      ORIGIN,
    );
    expect(decision).toEqual({ outcome: 'denied', denial: { reason: 'unknown-platform' } });
  });

  it.each([
    ['javascript:alert(1)', 'forbidden-scheme'],
    ['data:text/html,x', 'forbidden-scheme'],
    ['wss://relay.example', 'relay-url'],
    ['', 'empty'],
  ])('refuses %s before anything opens', (url, detail) => {
    const decision = decideEgress(STANDARD_POLICY, { class: 'external-link', url }, ORIGIN);
    expect(decision).toEqual({
      outcome: 'denied',
      denial: { reason: 'invalid-destination', detail },
    });
  });

  it('refuses an internal route rather than performing it', () => {
    // Reaching for the external API to move around inside the island is a
    // mistake worth surfacing, not one to quietly carry out.
    const decision = decideEgress(
      STANDARD_POLICY,
      { class: 'external-link', url: '/settings' },
      ORIGIN,
    );
    expect(decision).toEqual({ outcome: 'denied', denial: { reason: 'internal-destination' } });
  });
});

// ── Family ──────────────────────────────────────────────────────────────────

describe('Family', () => {
  it.each([
    ['external-link', { class: 'external-link', url: 'https://github.com' }],
    ['social-share', { class: 'social-share', platform: 'telegram', payload: PAYLOAD }],
    ['native-share', { class: 'native-share', data: { title: 'x' } }],
  ] as const)('denies %s on the capability', (_label, request) => {
    expect(decideEgress(FAMILY_POLICY, request as EgressRequest, ORIGIN)).toEqual({
      outcome: 'denied',
      denial: { reason: 'capability', egressClass: (request as EgressRequest).class },
    });
  });

  it('denies before the URL is even examined', () => {
    // "Denied" must not depend on whether the destination happened to parse.
    const decision = decideEgress(
      FAMILY_POLICY,
      { class: 'external-link', url: 'javascript:alert(1)' },
      ORIGIN,
    );
    expect(decision.outcome).toBe('denied');
    expect(decision.outcome === 'denied' && decision.denial.reason).toBe('capability');
  });
});

// ── The browser call ────────────────────────────────────────────────────────

describe('performEgress is the only thing that touches the browser', () => {
  it('opens a link with opener isolation', async () => {
    await performEgress({ class: 'external-link', url: 'https://github.com' }, 'https://github.com');
    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0];
    expect(url).toBe('https://github.com');
    expect(target).toBe('_blank');
    // Without `noopener` the opened page gets a live handle to this tab and can
    // navigate it: the tabnabbing the scattered calls were all exposed to.
    expect(features).toContain('noopener');
    expect(features).toContain('noreferrer');
  });

  it('keeps the compact popup geometry for a social share', async () => {
    await performEgress(
      { class: 'social-share', platform: 'telegram', payload: PAYLOAD },
      'https://t.me/share/url?url=x',
    );
    const [, , features] = openSpy.mock.calls[0];
    expect(features).toContain('noopener');
    expect(features).toContain('width=600');
  });

  it('hands a native share to the OS', async () => {
    const data = { title: 'x' };
    expect(await performEgress({ class: 'native-share', data })).toBe(true);
    expect(shareSpy).toHaveBeenCalledWith(data);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('reports a dismissed share sheet as "did not happen", not as an error', async () => {
    shareSpy.mockRejectedValueOnce(new Error('AbortError'));
    expect(await performEgress({ class: 'native-share', data: { title: 'x' } })).toBe(false);
  });

  it('opens nothing without a URL', async () => {
    expect(await performEgress({ class: 'external-link', url: 'https://x.test' })).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('canNativeShare', () => {
  it('is false when the browser has no share API', () => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    expect(canNativeShare({ title: 'x' })).toBe(false);
  });

  it('consults canShare for a file payload', () => {
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
    expect(canNativeShare({ files: [new File([''], 'x.png')] })).toBe(false);
  });

  it('allows a data-only share where canShare is missing', () => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    expect(canNativeShare({ title: 'x' })).toBe(true);
  });
});
