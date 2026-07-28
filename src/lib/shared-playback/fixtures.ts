/**
 * The protocol document's §16 timeline, as data.
 *
 * These are the EXACT events printed in `docs/protocol/shared-playback-session.md`
 * §16.1–16.16 (ids and signatures omitted there, so synthesized here). Round-
 * tripping them is how the implementation is pinned to the specification rather
 * than to itself: if a builder or a parser drifts, a documented example stops
 * matching and a test fails.
 *
 * Test-only, but not in a `.test.ts` file because several suites share it.
 */

import type { NostrEvent } from '@nostrify/nostrify';

export const HOST_PUBKEY = '9f2e6d4c8b1a7350e2c4f6a8b0d1e3f5a7c9b2d4e6f8a0c2e4d6b8a0c2e4f6d8';
export const OTHER_PUBKEY = '1111111111111111111111111111111111111111111111111111111111111111';
export const SESSION_D = '3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34';
export const CODE = 'B7X4QP';
export const ROOM = 'blobbi-island:theater:main';
export const ADDRESS = `31951:${HOST_PUBKEY}:${SESSION_D}`;
export const RELAY_HINT = 'wss://relay.ditto.pub';

/** 2026-07-27 18:00:00 in the document's timeline. */
export const T0_SEC = 1785175200;
export const T0_MS = T0_SEC * 1000;

const MEDIA_A = 'aVmB8bZ1kQs';
const MEDIA_B = 'Nk9pQ2rT7wY';

let idCounter = 0;
/** Deterministic stand-in for a real event id (never verified here). */
function nextId(): string {
  idCounter += 1;
  return idCounter.toString(16).padStart(64, '0');
}

export function sessionTags(input: {
  code?: string | null;
  mediaId: string;
  status: 'active' | 'ended';
  expiration: number;
}): string[][] {
  return [
    ['d', SESSION_D],
    ['r', ROOM],
    ...(input.code === null ? [] : [['c', input.code ?? CODE]]),
    ['t', 'shared-playback'],
    ['t', 'youtube'],
    ['provider', 'youtube'],
    ['media', input.mediaId],
    ['status', input.status],
    ['client', 'blobbi-island'],
    ['alt', 'Shared playback session in the Blobbi Island theater'],
    ['expiration', String(input.expiration)],
  ];
}

export function makeSessionEvent(overrides: {
  createdAt: number;
  content: string;
  status?: 'active' | 'ended';
  mediaId?: string;
  code?: string | null;
  expiration?: number;
  pubkey?: string;
  kind?: number;
  tags?: string[][];
  id?: string;
}): NostrEvent {
  const status = overrides.status ?? 'active';
  return {
    id: overrides.id ?? nextId(),
    pubkey: overrides.pubkey ?? HOST_PUBKEY,
    kind: overrides.kind ?? 31951,
    created_at: overrides.createdAt,
    content: overrides.content,
    sig: '0'.repeat(128),
    tags:
      overrides.tags ??
      sessionTags({
        code: overrides.code,
        mediaId: overrides.mediaId ?? MEDIA_A,
        status,
        expiration: overrides.expiration ?? overrides.createdAt + 14400,
      }),
  };
}

export function makeCommandEvent(overrides: {
  createdAt: number;
  content: string;
  expiration?: number;
  pubkey?: string;
  kind?: number;
  address?: string;
  tags?: string[][];
  id?: string;
}): NostrEvent {
  return {
    id: overrides.id ?? nextId(),
    pubkey: overrides.pubkey ?? HOST_PUBKEY,
    kind: overrides.kind ?? 21951,
    created_at: overrides.createdAt,
    content: overrides.content,
    sig: '0'.repeat(128),
    tags:
      overrides.tags ??
      [
        ['a', overrides.address ?? ADDRESS, RELAY_HINT],
        ['p', HOST_PUBKEY],
        ['t', 'shared-playback'],
        ['client', 'blobbi-island'],
        ['alt', 'Shared playback command'],
        ['expiration', String(overrides.expiration ?? overrides.createdAt + 30)],
      ],
  };
}

/** §16.1–16.7 — the canonical half of the timeline. */
export const CANONICAL_EXAMPLES: Array<{ label: string; event: NostrEvent }> = [
  {
    label: '16.1 rev 0 · created, paused at zero',
    event: makeSessionEvent({
      createdAt: 1785175200,
      expiration: 1785189600,
      content:
        '{"version":1,"rev":0,"media":{"provider":"youtube","id":"aVmB8bZ1kQs"},"playback":{"state":"paused","position":0,"updatedAt":1785175200000,"rate":1},"permissions":{"mode":"host-only"}}',
    }),
  },
  {
    label: '16.2 rev 1 · playing',
    event: makeSessionEvent({
      createdAt: 1785175230,
      expiration: 1785189630,
      content:
        '{"version":1,"rev":1,"media":{"provider":"youtube","id":"aVmB8bZ1kQs"},"playback":{"state":"playing","position":0,"updatedAt":1785175230000,"rate":1},"permissions":{"mode":"host-only"}}',
    }),
  },
  {
    label: '16.3 rev 2 · paused at 42.5 s',
    event: makeSessionEvent({
      createdAt: 1785175273,
      expiration: 1785189673,
      content:
        '{"version":1,"rev":2,"media":{"provider":"youtube","id":"aVmB8bZ1kQs"},"playback":{"state":"paused","position":42.5,"updatedAt":1785175273000,"rate":1},"permissions":{"mode":"host-only"}}',
    }),
  },
  {
    label: '16.4 rev 3 · seek to 600 s while playing',
    event: makeSessionEvent({
      createdAt: 1785175295,
      expiration: 1785189695,
      content:
        '{"version":1,"rev":3,"media":{"provider":"youtube","id":"aVmB8bZ1kQs"},"playback":{"state":"playing","position":600,"updatedAt":1785175295000,"rate":1},"permissions":{"mode":"host-only"}}',
    }),
  },
  {
    label: '16.5 rev 7 · media changed, state preserved',
    event: makeSessionEvent({
      createdAt: 1785175400,
      expiration: 1785189800,
      mediaId: MEDIA_B,
      content:
        '{"version":1,"rev":7,"media":{"provider":"youtube","id":"Nk9pQ2rT7wY"},"playback":{"state":"playing","position":0,"updatedAt":1785175400000,"rate":1},"permissions":{"mode":"host-only"}}',
    }),
  },
  {
    label: '16.6 rev 8 · playback rate 1.25',
    event: makeSessionEvent({
      createdAt: 1785175435,
      expiration: 1785189835,
      mediaId: MEDIA_B,
      content:
        '{"version":1,"rev":8,"media":{"provider":"youtube","id":"Nk9pQ2rT7wY"},"playback":{"state":"playing","position":35,"updatedAt":1785175435000,"rate":1.25},"permissions":{"mode":"host-only"}}',
    }),
  },
  {
    label: '16.7 rev 9 · session ended',
    event: makeSessionEvent({
      createdAt: 1785175500,
      expiration: 1785176100,
      mediaId: MEDIA_B,
      status: 'ended',
      content:
        '{"version":1,"rev":9,"media":{"provider":"youtube","id":"Nk9pQ2rT7wY"},"playback":{"state":"paused","position":116.25,"updatedAt":1785175500000,"rate":1.25},"permissions":{"mode":"host-only"}}',
    }),
  },
];

/** §16.8–16.16 — the ephemeral half. */
export const COMMAND_EXAMPLES: Array<{ label: string; event: NostrEvent }> = [
  {
    label: '16.8 rev 1 · play',
    event: makeCommandEvent({
      createdAt: 1785175230,
      content: '{"version":1,"command":"play","rev":1,"position":0,"updatedAt":1785175230000,"rate":1}',
    }),
  },
  {
    label: '16.9 rev 2 · pause',
    event: makeCommandEvent({
      createdAt: 1785175273,
      content: '{"version":1,"command":"pause","rev":2,"position":42.5,"updatedAt":1785175273000,"rate":1}',
    }),
  },
  {
    label: '16.10 rev 3 · direct seek',
    event: makeCommandEvent({
      createdAt: 1785175295,
      content:
        '{"version":1,"command":"seek","rev":3,"position":600,"updatedAt":1785175295000,"rate":1,"reason":"direct"}',
    }),
  },
  {
    label: '16.11 rev 4 · skip forward',
    event: makeCommandEvent({
      createdAt: 1785175320,
      content:
        '{"version":1,"command":"seek","rev":4,"position":635,"updatedAt":1785175320000,"rate":1,"reason":"skip-forward"}',
    }),
  },
  {
    label: '16.12 rev 5 · skip backward',
    event: makeCommandEvent({
      createdAt: 1785175340,
      content:
        '{"version":1,"command":"seek","rev":5,"position":645,"updatedAt":1785175340000,"rate":1,"reason":"skip-backward"}',
    }),
  },
  {
    label: '16.13 rev 6 · restart',
    event: makeCommandEvent({
      createdAt: 1785175360,
      content:
        '{"version":1,"command":"seek","rev":6,"position":0,"updatedAt":1785175360000,"rate":1,"reason":"restart"}',
    }),
  },
  {
    label: '16.14 rev 7 · set media',
    event: makeCommandEvent({
      createdAt: 1785175400,
      content:
        '{"version":1,"command":"set-media","rev":7,"media":{"provider":"youtube","id":"Nk9pQ2rT7wY"},"state":"playing","position":0,"updatedAt":1785175400000,"rate":1}',
    }),
  },
  {
    label: '16.15 rev 8 · set rate',
    event: makeCommandEvent({
      createdAt: 1785175435,
      content: '{"version":1,"command":"set-rate","rev":8,"position":35,"updatedAt":1785175435000,"rate":1.25}',
    }),
  },
  {
    label: '16.16 rev 9 · end session',
    event: makeCommandEvent({
      createdAt: 1785175500,
      content: '{"version":1,"command":"end-session","rev":9,"position":116.25,"updatedAt":1785175500000}',
    }),
  },
];
