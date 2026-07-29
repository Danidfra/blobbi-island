/**
 * The Guest Game trust decision — recorded, and provably not wired up.
 *
 * A future-facing constant is only worth adding if it cannot quietly become
 * load-bearing before the thing it describes exists. Three assertions make that
 * checkable: the key must BE the official issuer's (not a second copy of it), it
 * must encode to the npub the decision was taken against, and **no other module
 * in `src/` may reference it** — which is what "documented in Phase 4,
 * implemented in Phase 5" means in practice.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';

import {
  GUEST_GAME_RUNTIME_AVAILABLE,
  GUEST_GAME_UNAVAILABLE_MESSAGE,
  OFFICIAL_GUEST_GAME_PUBLISHER_PUBKEY,
} from './guest-game-trust';
import { OFFICIAL_ISSUER_PUBKEY } from '@/protocol/event-registry';

/** The npub the product decision was written against, verbatim from the brief. */
const DECISION_NPUB = 'npub1nmac6vz9hf6n7dny65pnpz6f0qe4dvn2d405h9ztltzz8xh7vw5sg0wu5e';

const SRC = join(process.cwd(), 'src');
const MODULE = join(SRC, 'arcade/guest-game-trust.ts');

function allSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? allSourceFiles(full) : /\.tsx?$/.test(full) ? [full] : [];
  });
}

describe('the official publisher', () => {
  it('is the official Blobbi issuer, not a second copy of the key', () => {
    expect(OFFICIAL_GUEST_GAME_PUBLISHER_PUBKEY).toBe(OFFICIAL_ISSUER_PUBKEY);
    // No literal here: a rotation must have exactly one place to change.
    expect(readFileSync(MODULE, 'utf8')).not.toMatch(/[0-9a-f]{64}/);
  });

  it('is the key the product decision names', () => {
    const decoded = nip19.decode(DECISION_NPUB);
    expect(decoded.type).toBe('npub');
    expect(decoded.data).toBe(OFFICIAL_GUEST_GAME_PUBLISHER_PUBKEY);
    expect(nip19.npubEncode(OFFICIAL_GUEST_GAME_PUBLISHER_PUBKEY)).toBe(DECISION_NPUB);
  });

  it('is a public key and nothing else', () => {
    expect(OFFICIAL_GUEST_GAME_PUBLISHER_PUBKEY).toMatch(/^[0-9a-f]{64}$/);
    // No private material exists anywhere in this repository, and an `nsec`
    // would be the shape of that mistake.
    expect(readFileSync(MODULE, 'utf8')).not.toMatch(/nsec1/);
  });
});

describe('nothing uses it yet', () => {
  it('is referenced by no other module in src/', () => {
    const referrers = allSourceFiles(SRC)
      .filter((file) => !/guest-game-trust(\.test)?\.ts$/.test(file))
      .filter((file) =>
        readFileSync(file, 'utf8').includes('OFFICIAL_GUEST_GAME_PUBLISHER_PUBKEY'),
      )
      .map((file) => file.replace(`${process.cwd()}/`, ''));

    expect(
      referrers,
      `the guest publisher key is meant to be inert in this phase, but it is used in: ${referrers.join(', ')}`,
    ).toEqual([]);
  });

  it('declares no runtime, and says why in words a player can read', () => {
    expect(GUEST_GAME_RUNTIME_AVAILABLE).toBe(false);
    expect(GUEST_GAME_UNAVAILABLE_MESSAGE).toMatch(/not ready yet/i);
    // Child-facing copy: no protocol, no packages, no sandboxes.
    for (const jargon of ['webxdc', 'nostr', 'sandbox', 'issuer', 'relay', 'publisher']) {
      expect(GUEST_GAME_UNAVAILABLE_MESSAGE.toLowerCase(), jargon).not.toContain(jargon);
    }
  });

  it('performs no execution and reaches no relay', () => {
    const source = readFileSync(MODULE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    for (const forbidden of ['iframe', 'import(', 'fetch(', 'query(', 'http']) {
      expect(source.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});
