import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PlayerFacingError, looksTechnical, playerFacingMessage } from './player-facing-error';

describe('looksTechnical', () => {
  it('keeps sentences written for a player', () => {
    for (const message of [
      'Only 2 Strawberry left in that inventory (asked for 3).',
      'Not enough Coins for that.',
      'Strawberry cannot be used on a baby Blobbi',
      'Could not read that inventory right now; nothing was spent.',
      'That purchase could not be confirmed yet.',
    ]) {
      expect(looksTechnical(message), message).toBe(false);
    }
  });

  it('flags ids, protocol wording and runtime phrasing', () => {
    for (const message of [
      'Could not read the farm:main inventory: no relay',
      'Item has no usable action: 31632:f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4:farm:produce:strawberry',
      'All relays failed',
      'The spend was refused by every relay: timeout',
      'wss://relay.ditto.pub refused the event',
      'kind:31633 publish rejected',
      "Cannot read properties of undefined (reading 'pubkey')",
      'The operation was aborted',
      'signal timed out',
      '',
      '   ',
    ]) {
      expect(looksTechnical(message), message).toBe(true);
    }
  });
});

describe('playerFacingMessage', () => {
  it('passes a readable message through and replaces a technical one', () => {
    expect(playerFacingMessage(new Error('Not enough Coins for that.'), 'fallback')).toBe('Not enough Coins for that.');
    expect(playerFacingMessage(new Error('All relays failed'), 'fallback')).toBe('fallback');
    expect(playerFacingMessage('a string', 'fallback')).toBe('fallback');
    expect(playerFacingMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('always shows a PlayerFacingError, even one that mentions a relay', () => {
    expect(playerFacingMessage(new PlayerFacingError('Your relay list is empty.'), 'fallback')).toBe('Your relay list is empty.');
  });
});

/**
 * The surfaces a player reaches from the island must not forward a raw
 * `error.message` into a toast or panel. This reads the sources, so a new
 * `description: error.message` in one of them fails here rather than in a
 * player's screenshot.
 */
describe('game surfaces do not forward raw error messages', () => {
  const surfaces = [
    'src/components/blobbi/inventory/InventoryBrowser.tsx',
    'src/components/blobbi/ChestModal.tsx',
    'src/components/blobbi/RefrigeratorModal.tsx',
    'src/components/blobbi/FoodShopModal.tsx',
    'src/components/blobbi/StageBackgroundPicker.tsx',
    'src/components/blobbi/BlobbiInfoModal.tsx',
    'src/components/blobbi/arcade/ArcadeTokenShopModal.tsx',
    'src/components/blobbi/clothing-store/ClothingStoreModal.tsx',
    'src/components/blobbi/care-store/CareStoreModal.tsx',
    'src/components/shell/ThemeCreateDialog.tsx',
  ];

  it.each(surfaces)('%s routes errors through playerFacingMessage', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(source).not.toMatch(/\b(?:error|err|e)\.message\b/);
    expect(source).toMatch(/playerFacingMessage\(/);
  });
});
