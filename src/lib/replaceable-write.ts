/**
 * Primitives shared by every writer of REPLACEABLE Nostr state.
 *
 * kind:31633 (inventory) and kind:31124 (pet state) are different domains with
 * different locks, ledgers and policies, but they share two mechanical hazards
 * that have already caused real data loss in this app:
 *
 * 1. **Interleaved read-modify-write.** A replaceable publish does not patch,
 *    it REPLACES. Two writers that build from the same base silently destroy
 *    each other's work, whichever lands last wins, whole.
 * 2. **Same-second ties.** Nostr timestamps have second resolution and NIP-01
 *    breaks a tie between two replaceable events by lowest id, so two writes
 *    inside one second can make the newer one silently lose.
 *
 * Both fixes live here so no domain has to reimplement them. What does NOT
 * live here is anything domain-specific: lock NAMES, ledgers, validation and
 * publish policy stay with their own writers.
 */

/**
 * Per-key promise chains. Keyed so unrelated subjects never block each other:
 * inventory writes serialize per owner, pet-state writes per owner+pet.
 */
const chains = new Map<string, Promise<unknown>>();

/**
 * Run `task` after every previously-queued task for the SAME key.
 *
 * Errors are swallowed on the CHAIN (so one failure cannot wedge the queue)
 * but still propagate to the caller that scheduled the task.
 */
export function serializeByKey<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  chains.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/**
 * `created_at` for the next revision of a replaceable event: strictly greater
 * than the revision being replaced, even when several writes land inside one
 * wall-clock second.
 */
export function nextReplaceableCreatedAt(
  nowMs: number,
  previousCreatedAt: number,
): number {
  return Math.max(Math.floor(nowMs / 1000), previousCreatedAt + 1);
}
