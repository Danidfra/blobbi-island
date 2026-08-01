/**
 * The build-time flag parser — strict by design.
 *
 * A mutation-capable surface must never appear because of a typo'd or
 * half-set environment, so ONLY the exact string "true" enables. There is no
 * dev-mode auto-enable (see the module doc for why the `/dev/*` convention
 * does not apply to flagged production surfaces).
 */
import { describe, it, expect } from 'vitest';

import { isFeatureFlagEnabled, LIVE_INVENTORY_LAB_ENABLED } from './feature-flags';

describe('isFeatureFlagEnabled', () => {
  it('enables ONLY the exact string "true"', () => {
    expect(isFeatureFlagEnabled('true')).toBe(true);
  });

  it('disables everything else, including near-misses', () => {
    for (const value of [
      undefined,
      '',
      'false',
      '1',
      'TRUE',
      'True',
      ' true',
      'true ',
      'yes',
      'on',
      'enabled',
    ]) {
      expect(isFeatureFlagEnabled(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('LIVE_INVENTORY_LAB_ENABLED', () => {
  it('is disabled in the default (unset) test environment', () => {
    // The repository sets no VITE_ENABLE_LIVE_INVENTORY_LAB anywhere, so the
    // default everywhere — dev, test, production build — is OFF.
    expect(LIVE_INVENTORY_LAB_ENABLED).toBe(false);
  });
});
