/**
 * Relay reads that can say "I don't know".
 *
 * The bug this suite pins: `NPool.query()` never throws — a timeout, a dead
 * socket and a genuinely empty relay all produce `[]`, so the app recorded
 * "this player owns nothing" whenever the network hiccuped. These tests drive
 * the wrapper through the same message shapes `NRelay.req()` produces.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  RelayReadUnknownError,
  isRelayReadUnknown,
  readRelay,
  readRelayConfirmed,
  readRelayConfirmedOrThrow,
  readRelayEventsOrThrow,
  supportsCompletionAwareReads,
  type RelayReader,
} from './relay-read';

type ReqMessage =
  | ['EVENT', string, NostrEvent]
  | ['EOSE', string]
  | ['CLOSED', string, string];

function event(id: string): NostrEvent {
  return {
    id,
    pubkey: 'f'.repeat(64),
    kind: 1,
    created_at: 1,
    content: '',
    tags: [],
    sig: 'sig',
  };
}

/** A pool whose `req` replays a scripted message sequence. */
function reader(script: () => AsyncIterable<ReqMessage>): RelayReader {
  return {
    req: () => script(),
    query: async () => {
      throw new Error('query must not be used when req is available');
    },
  };
}

/** Never yields, never completes — until the caller's signal aborts. */
function silentReader(): RelayReader {
  return {
    req: (_filters, opts) => ({
      async *[Symbol.asyncIterator]() {
        await new Promise<void>((_resolve, reject) => {
          opts?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The signal has been aborted', 'AbortError')),
            { once: true },
          );
        });
        yield ['EOSE', 'sub'] as ReqMessage; // unreachable
      },
    }),
    query: async () => [],
  };
}

describe('completion semantics', () => {
  it('EVENT… then EOSE is ANSWERED', async () => {
    const outcome = await readRelay(
      reader(async function* () {
        yield ['EVENT', 'sub', event('a')];
        yield ['EVENT', 'sub', event('b')];
        yield ['EOSE', 'sub'];
      }),
      [{ kinds: [1] }],
    );
    expect(outcome).toMatchObject({ status: 'answered' });
    expect(outcome.status === 'answered' && outcome.events).toHaveLength(2);
  });

  it('EOSE with no events is ANSWERED-EMPTY — the only confirmed empty', async () => {
    const outcome = await readRelay(
      reader(async function* () {
        yield ['EOSE', 'sub'];
      }),
      [{ kinds: [1] }],
    );
    expect(outcome).toEqual({ status: 'answered', events: [] });
  });

  it('our timeout before EOSE is UNKNOWN, never empty', async () => {
    const outcome = await readRelay(silentReader(), [{ kinds: [1] }], { timeoutMs: 40 });
    expect(outcome).toEqual({ status: 'unknown', reason: 'timeout', partialCount: 0 });
  });

  it('PARTIAL events then timeout is UNKNOWN, and reports the partial count', async () => {
    // Signal-aware, exactly like NPool's `Machina`: it throws AbortError when
    // the read is cut short, after some events have already arrived.
    const partialReader: RelayReader = {
      req: (_filters, opts) => ({
        async *[Symbol.asyncIterator]() {
          yield ['EVENT', 'sub', event('a')] as ReqMessage;
          await new Promise<void>((_resolve, reject) => {
            opts?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('The signal has been aborted', 'AbortError')),
              { once: true },
            );
          });
        },
      }),
      query: async () => [],
    };
    const outcome = await readRelay(partialReader, [{ kinds: [1] }], { timeoutMs: 40 });
    // "3 of your 5 Blobbis" is a worse lie than "we don't know yet".
    expect(outcome).toEqual({ status: 'unknown', reason: 'timeout', partialCount: 1 });
  });

  it('CLOSED before EOSE is UNKNOWN', async () => {
    const outcome = await readRelay(
      reader(async function* () {
        yield ['CLOSED', 'sub', 'rate-limited'];
      }),
      [{ kinds: [1] }],
    );
    expect(outcome).toEqual({ status: 'unknown', reason: 'closed', partialCount: 0 });
  });

  it('a transport throw is UNKNOWN', async () => {
    const outcome = await readRelay(
      reader(async function* () {
        yield ['EVENT', 'sub', event('a')];
        throw new Error('socket died');
      }),
      [{ kinds: [1] }],
    );
    expect(outcome).toEqual({ status: 'unknown', reason: 'unreachable', partialCount: 1 });
  });

  it('an iterator that ends without EOSE is UNKNOWN (no relay routed)', async () => {
    const outcome = await readRelay(
      reader(async function* () {
        // nothing at all
      }),
      [{ kinds: [1] }],
    );
    expect(outcome).toEqual({ status: 'unknown', reason: 'unreachable', partialCount: 0 });
  });

  it("the caller's abort is attributed to the caller, not to our deadline", async () => {
    const controller = new AbortController();
    const promise = readRelay(silentReader(), [{ kinds: [1] }], {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).resolves.toEqual({
      status: 'unknown',
      reason: 'aborted',
      partialCount: 0,
    });
  });
});

describe('throwing variants keep React Query data alive', () => {
  it('readRelayEventsOrThrow throws a typed error on unknown', async () => {
    await expect(
      readRelayEventsOrThrow(silentReader(), [{ kinds: [1] }], { timeoutMs: 40 }),
    ).rejects.toBeInstanceOf(RelayReadUnknownError);
  });

  it('the thrown error is recognisable and carries no transport detail', async () => {
    try {
      await readRelayEventsOrThrow(silentReader(), [{ kinds: [1] }], { timeoutMs: 40 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isRelayReadUnknown(error)).toBe(true);
      expect((error as RelayReadUnknownError).reason).toBe('timeout');
      expect((error as Error).message).toBe('relay-read-timeout');
    }
  });

  it('an answered-empty read resolves to [] rather than throwing', async () => {
    await expect(
      readRelayEventsOrThrow(
        reader(async function* () {
          yield ['EOSE', 'sub'];
        }),
        [{ kinds: [1] }],
      ),
    ).resolves.toEqual([]);
  });
});

describe('confirmed-empty policy', () => {
  function scripted(scripts: ReqMessage[][]): { reader: RelayReader; reads: () => number } {
    let call = 0;
    return {
      reader: {
        req: () => {
          const script = scripts[Math.min(call, scripts.length - 1)];
          call += 1;
          return (async function* () {
            for (const msg of script) yield msg;
          })();
        },
        query: async () => [],
      },
      reads: () => call,
    };
  }

  it('a non-empty first answer costs exactly ONE read', async () => {
    const { reader: r, reads } = scripted([[['EVENT', 's', event('a')], ['EOSE', 's']]]);
    const outcome = await readRelayConfirmed(r, [{ kinds: [1] }]);
    expect(outcome).toMatchObject({ status: 'answered' });
    expect(reads()).toBe(1);
  });

  it('empty then empty is CONFIRMED empty (a real new player can still start)', async () => {
    const { reader: r, reads } = scripted([[['EOSE', 's']], [['EOSE', 's']]]);
    const outcome = await readRelayConfirmed(r, [{ kinds: [1] }]);
    expect(outcome).toEqual({ status: 'answered', events: [] });
    expect(reads()).toBe(2);
  });

  it('empty then NON-empty accepts the non-empty answer', async () => {
    const { reader: r } = scripted([
      [['EOSE', 's']],
      [['EVENT', 's', event('a')], ['EOSE', 's']],
    ]);
    const outcome = await readRelayConfirmed(r, [{ kinds: [1] }]);
    expect(outcome.status === 'answered' && outcome.events).toHaveLength(1);
  });

  it('empty then UNKNOWN is unknown — never confirmed empty', async () => {
    const { reader: r } = scripted([[['EOSE', 's']], [['CLOSED', 's', 'nope']]]);
    const outcome = await readRelayConfirmed(r, [{ kinds: [1] }]);
    expect(outcome).toMatchObject({ status: 'unknown', reason: 'closed' });
    await expect(readRelayConfirmedOrThrow(r, [{ kinds: [1] }])).rejects.toBeInstanceOf(
      RelayReadUnknownError,
    );
  });

  it('is bounded to two reads — no loop, no backoff', async () => {
    const { reader: r, reads } = scripted([[['EOSE', 's']]]);
    await readRelayConfirmed(r, [{ kinds: [1] }]);
    expect(reads()).toBe(2);
  });
});

describe('degraded fallback for query-only fakes', () => {
  it('is reported, so production can be asserted to have the real API', async () => {
    expect(supportsCompletionAwareReads({ query: async () => [] })).toBe(false);
    expect(supportsCompletionAwareReads(silentReader())).toBe(true);
  });

  it('treats a resolved query as answered when req is unavailable', async () => {
    const outcome = await readRelay({ query: async () => [event('a')] }, [{ kinds: [1] }]);
    expect(outcome).toMatchObject({ status: 'answered' });
  });

  it('treats a rejected query as unknown when req is unavailable', async () => {
    const outcome = await readRelay(
      {
        query: async () => {
          throw new Error('boom');
        },
      },
      [{ kinds: [1] }],
    );
    expect(outcome).toMatchObject({ status: 'unknown', reason: 'unreachable' });
  });
});
