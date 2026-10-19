/**
 * The world registry: which doors are open, where they lead, and that no
 * address is ever guessed: a world without a checked address is shown and
 * never a link; an override that is not a travel address is ignored.
 */
import { describe, expect, it } from 'vitest';
import { WORLD_HOME, WORLD_PIXEL } from '@blobbi-kit/core';

import { NOSTR_FARM_URL } from '@/connected-experiences';

import { WORLD_FARM, WORLD_ISLAND, WORLD_RUMBLE, isTravelUrl, worldById, worldByTravelId, worldUrlEnvName, worldUrlOverrides, worlds } from './worlds';

describe('the worlds a Blobbi can travel to', () => {
  it('lists the four worlds in order, each with its World Travel id', () => {
    expect(worlds({}).map((w) => [w.id, w.travelId])).toEqual([
      ['home', WORLD_HOME],
      ['pixel', WORLD_PIXEL],
      ['farm', WORLD_FARM],
      ['rumble', WORLD_RUMBLE],
    ]);
    expect(WORLD_ISLAND).toBe('blobbi-island');
  });

  it('opens only the worlds with a checked https address, and Rumble (not answering) is never a link', () => {
    const list = worlds({});
    expect(worldById('home', {})).toMatchObject({ open: true, url: 'https://blobbi.pet/' });
    expect(worldById('pixel', {})).toMatchObject({ open: true, url: 'https://pixel.blobbi.pet/' });
    expect(worldById('farm', {})).toMatchObject({ open: true, url: NOSTR_FARM_URL });
    expect(worldById('rumble', {})).toMatchObject({ open: false, url: null });
    for (const w of list) expect(w.open).toBe(isTravelUrl(w.url));
  });

  it('the Farm door is the Station registry address, written once', () => {
    expect(worldById('farm', {})!.url).toBe(NOSTR_FARM_URL);
  });

  it('a travel address is absolute https with no credentials; nothing else is', () => {
    expect(isTravelUrl('https://pixel.blobbi.pet/')).toBe(true);
    expect(isTravelUrl('http://localhost:5173/')).toBe(false);
    expect(isTravelUrl('https://user:pw@pixel.blobbi.pet/')).toBe(false);
    expect(isTravelUrl('javascript:alert(1)')).toBe(false);
    expect(isTravelUrl('wss://relay.ditto.pub')).toBe(false);
    expect(isTravelUrl('/pixel')).toBe(false);
    expect(isTravelUrl('')).toBe(false);
    expect(isTravelUrl(null)).toBe(false);
  });

  it('a build may point a world at a staging address; an override that is not a travel address is ignored', () => {
    expect(worldUrlEnvName('pixel')).toBe('VITE_BLOBBI_WORLD_URL_PIXEL');
    const overrides = worldUrlOverrides({
      VITE_BLOBBI_WORLD_URL_PIXEL: ' https://pixel-staging.example/ ',
      VITE_BLOBBI_WORLD_URL_RUMBLE: 'https://rumble-staging.example/',
      VITE_BLOBBI_WORLD_URL_HOME: 'javascript:alert(1)',
      VITE_BLOBBI_WORLD_URL_FARM: '',
    });
    expect(overrides).toEqual({ pixel: 'https://pixel-staging.example/', rumble: 'https://rumble-staging.example/' });
    expect(worldById('pixel', overrides)!.url).toBe('https://pixel-staging.example/');
    // An override opens a door that was closed, when it is a travel address
    expect(worldById('rumble', overrides)).toMatchObject({ open: true });
    expect(worldById('home', overrides)!.url).toBe('https://blobbi.pet/');
  });

  it('finds a world by its World Travel id, and none for an id that is not ours', () => {
    expect(worldByTravelId(WORLD_PIXEL, {})?.id).toBe('pixel');
    expect(worldByTravelId('some-other-world', {})).toBeUndefined();
    expect(worldByTravelId(WORLD_ISLAND, {})).toBeUndefined();
  });
});
