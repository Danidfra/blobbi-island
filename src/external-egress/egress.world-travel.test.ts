/**
 * World travel through the boundary: the same capability as any other way
 * out, the same address rules, no confirmation dialog (the departure's Stay
 * is the moment to change one's mind), and the one same-tab navigation in
 * the application: this tab goes, and the request carries nothing but the
 * checked address (no query string, no fragment: where the Blobbi is travels
 * on Nostr, never in the URL).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FAMILY_POLICY, STANDARD_POLICY } from '@/safety';

import { EGRESS_CAPABILITY, EGRESS_REQUIRES_CONFIRMATION, isEgressAllowed } from './classes';
import { decideEgress, performEgress, type EgressRequest } from './egress';

const ORIGIN = 'https://island.blobbi.pet';
const TRIP: EgressRequest = { class: 'world-travel', url: 'https://pixel.blobbi.pet/', label: 'Blobbi Pixel' };

describe('world travel as an egress class', () => {
  it('is governed by the external-links capability and asks for no confirmation', () => {
    expect(EGRESS_CAPABILITY['world-travel']).toBe('externalLinks');
    expect(EGRESS_REQUIRES_CONFIRMATION['world-travel']).toBe(false);
    expect(isEgressAllowed(STANDARD_POLICY, 'world-travel')).toBe(true);
    expect(isEgressAllowed(FAMILY_POLICY, 'world-travel')).toBe(false);
  });

  it('is allowed outright for a standard experience, with the host parsed from the address', () => {
    expect(decideEgress(STANDARD_POLICY, TRIP, ORIGIN)).toEqual({
      outcome: 'allowed',
      destination: { egressClass: 'world-travel', host: 'pixel.blobbi.pet', url: 'https://pixel.blobbi.pet/', label: 'Blobbi Pixel' },
    });
  });

  it('is denied by the capability for a family experience, before the address is even looked at', () => {
    expect(decideEgress(FAMILY_POLICY, TRIP, ORIGIN)).toEqual({ outcome: 'denied', denial: { reason: 'capability', egressClass: 'world-travel' } });
    expect(decideEgress(FAMILY_POLICY, { ...TRIP, url: 'javascript:alert(1)' }, ORIGIN)).toEqual({ outcome: 'denied', denial: { reason: 'capability', egressClass: 'world-travel' } });
  });

  it('refuses any address that is not external https, and the Island itself', () => {
    expect(decideEgress(STANDARD_POLICY, { ...TRIP, url: 'http://pixel.blobbi.pet/' }, ORIGIN)).toMatchObject({ outcome: 'denied', denial: { reason: 'invalid-destination', detail: 'forbidden-scheme' } });
    expect(decideEgress(STANDARD_POLICY, { ...TRIP, url: 'wss://relay.ditto.pub' }, ORIGIN)).toMatchObject({ outcome: 'denied', denial: { reason: 'invalid-destination', detail: 'relay-url' } });
    expect(decideEgress(STANDARD_POLICY, { ...TRIP, url: `${ORIGIN}/town` }, ORIGIN)).toEqual({ outcome: 'denied', denial: { reason: 'internal-destination' } });
  });
});

describe('performing a world trip', () => {
  const original = window.location;
  let assign: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assign = vi.fn();
    open = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...original, assign }, writable: true, configurable: true });
    window.open = open as unknown as typeof window.open;
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: original, writable: true, configurable: true });
    vi.restoreAllMocks();
  });

  it('navigates THIS tab to the decided address, and opens no window', async () => {
    await expect(performEgress(TRIP, 'https://pixel.blobbi.pet/')).resolves.toBe(true);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('https://pixel.blobbi.pet/');
    expect(open).not.toHaveBeenCalled();
  });

  it('carries nothing of this page along: the address it was given, exactly, and nothing a request could add to it', async () => {
    // A request has no field for a fragment or anything else to attach (the hand-off of older builds is gone)
    const request = { ...TRIP, fragment: 'blobbi-travel=v1.abc' } as EgressRequest;
    await performEgress(request, 'https://pixel.blobbi.pet/');
    expect(assign).toHaveBeenCalledWith('https://pixel.blobbi.pet/');
    const url = new URL(assign.mock.calls[0][0] as string);
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(url.username).toBe('');
  });

  it('without a decided address nothing happens; a navigation the browser refuses is reported as not gone', async () => {
    await expect(performEgress(TRIP)).resolves.toBe(false);
    expect(assign).not.toHaveBeenCalled();
    assign.mockImplementation(() => {
      throw new Error('blocked');
    });
    await expect(performEgress(TRIP, 'https://pixel.blobbi.pet/')).resolves.toBe(false);
  });

  it('an external link still opens a new window, never this tab', async () => {
    await performEgress({ class: 'external-link', url: 'https://soapbox.pub/mkstack' }, 'https://soapbox.pub/mkstack');
    expect(open).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });
});
