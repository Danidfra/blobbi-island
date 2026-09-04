/**
 * A QUEUED cross-tab exclusive lock, the wallet's counterpart to the arcade
 * claim lock.
 *
 * The arcade's `withClaimLock` refuses when the lock is held (`ifAvailable`),
 * because a second tab running the SAME claim after the first finished is
 * exactly the duplicate it exists to prevent. A currency wallet wants the
 * opposite: two DIFFERENT operations (a spend in one tab, a grant in another)
 * are both legitimate and must both run, just not interleaved, because each
 * one is a read-modify-write against the same replaceable event. So this lock
 * QUEUES: the second holder waits and then proceeds against the fresh state
 * the first one left behind. Idempotency of same-operation retries is the
 * durable op ledger's job, not this lock's.
 *
 * Where the Web Locks API is missing there is NO cross-tab protection, the
 * caller's per-tab serialization still holds, and that limitation is
 * documented rather than papered over (a localStorage lease cannot QUEUE
 * without polling, and a polling lease is worse than an honest fallback).
 */

type WebLockManager = {
  request: (
    name: string,
    options: { mode?: 'exclusive' | 'shared' },
    callback: (lock: unknown) => Promise<unknown>,
  ) => Promise<unknown>;
};

function webLocks(): WebLockManager | null {
  const nav = globalThis.navigator as (Navigator & { locks?: WebLockManager }) | undefined;
  return nav?.locks && typeof nav.locks.request === 'function' ? nav.locks : null;
}

/** Which mechanism actually guarded the call. Surfaced for honest reporting. */
export type QueuedLockKind = 'web-locks' | 'none';

export interface QueuedLockResult<T> {
  readonly kind: QueuedLockKind;
  readonly value: T;
}

/**
 * Run `fn` while exclusively holding the named cross-tab lock, waiting in
 * line behind other holders. Falls back to running unguarded (per-tab
 * serialization only) where Web Locks is unavailable.
 */
export async function withQueuedCrossTabLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<QueuedLockResult<T>> {
  const locks = webLocks();
  if (!locks) {
    return { kind: 'none', value: await fn() };
  }
  let value: T | undefined;
  await locks.request(name, { mode: 'exclusive' }, async () => {
    value = await fn();
  });
  return { kind: 'web-locks', value: value as T };
}

/** Which mechanism this environment will use. For docs and tests. */
export function queuedLockKind(): QueuedLockKind {
  return webLocks() ? 'web-locks' : 'none';
}
