/**
 * Blobbi Island's relay pool: one primary relay, the earlier relays as
 * secondaries, and one honest answer out of all of them.
 *
 * It is an `NPool`, so every hook keeps calling `nostr.req / query / event`
 * exactly as before. What changed is what those three calls mean:
 *
 * ## Reading (`req`, `query`)
 *
 * A REQ goes to every relay of its flow (`island-flows.ts`). The stored events
 * are held back until the answer can be trusted, then delivered as ONE merged
 * result (no id twice, the NIP-01 winner of every replaceable or addressable
 * address) followed by `EOSE`. The rule for "can be trusted" is the kit's
 * `decideRead`:
 *
 * ```
 *   every relay reached EOSE                → EOSE (an empty result is a real empty)
 *   a relay failed, another returned events → EOSE (degraded, still usable)
 *   only empty answers while a relay failed → CLOSED (unknown, NOT empty)
 *   nobody answered                         → CLOSED (unknown)
 * ```
 *
 * `relay-read.ts` already turns `CLOSED` and a timeout into "unknown", so the
 * app's confirmed-empty reads (does this account own a Blobbi, does it have an
 * inventory) keep their guarantee across several relays: a new, empty primary
 * cannot say "nothing here" while a secondary is silent, and a silent relay
 * is never an empty one. That is what stands between an empty relay and a
 * second adoption or a fresh 200-Coin inventory.
 *
 * A degraded answer is additionally checked against what this device already
 * knows (`KnownHeads`): if the relay that holds the newest revision is the one
 * that is down, the older revision another relay returns is reported as
 * unknown rather than handed to a writer as its base.
 *
 * Realtime flows (presence, chat, theater) are not held back: they stream
 * what arrives and end their stored phase on the first relay's EOSE.
 *
 * ## Writing (`event`)
 *
 * The same signed event is offered to every relay of its flow. The call
 * resolves when ONE relay accepts it and rejects only when every relay has
 * answered and none did. Each relay's verdict is recorded (`relay-status.ts`
 * and the delivery ledger). A relay that was silent is retried in the
 * background, with growing waits, but only if the event did land somewhere:
 * an event the caller was told had failed is never sent again behind its
 * back. A relay that refused (a write list, a kind it does not take) is
 * recorded as refused and left alone.
 *
 * ## Carrying (`RelaySync`): off until the account turns it on
 *
 * After a read, an event one relay returned and another relay certainly lacks
 * (it reached EOSE, and the filter was not truncated) CAN be offered to that
 * relay as the original signed event. `planSync` decides what and where;
 * `islandSyncPolicy` limits it to the player's own persistent state; the
 * ledger makes sure a pair (event, relay) is not offered again and again.
 *
 * None of that happens by default. Opening the app, restoring a saved login
 * and receiving the answer to a query are READS, and a read sends no `EVENT`.
 * Carrying starts only when the signed-in account chooses it (`consent`, set
 * from the Network panel, which shows the relays that would receive copies),
 * and then only toward the relays that account was shown.
 *
 * The one thing sent without that choice is a NEW event: something the player
 * just did (`event()`), including its retry to a relay that was silent.
 */

import { NPool, NRelay1 } from '@nostrify/nostrify';
import type { NostrEvent, NostrFilter, NostrRelayCLOSED, NostrRelayEOSE, NostrRelayEVENT, NRelay } from '@nostrify/nostrify';

import {
  allRelays,
  flowOfKind,
  isRealtimeRead,
  islandSyncPolicy,
  relaysForEvent,
  routeFilters,
  type IslandRelayConfig,
} from './island-flows';
import {
  SyncConsent,
  SyncLedger,
  classifyRejection,
  decideRead,
  eventAddress,
  isSyncableEvent,
  mergeRelayEvents,
  normalizeRelayUrl,
  planSync,
  replacesEvent,
  type DeliveryResult,
  type KnownHead,
  type RelayReadState,
  type SyncConsentRecord,
  type SyncLedgerEntry,
  type SyncTask,
  withSyncConsent,
} from './relay-routing';
import { RelayStatusStore, relayStatusStore } from './relay-status';

type RelayMessage = NostrRelayEVENT | NostrRelayEOSE | NostrRelayCLOSED;

// ── Small persistence helpers ───────────────────────────────────────────────

/** The slice of `Storage` this module uses; absent or throwing storage degrades to memory only. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readJson<T>(storage: KeyValueStore | undefined, key: string): T | undefined {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(storage: KeyValueStore | undefined, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the in-memory copy still serves this session.
  }
}

export const SYNC_LEDGER_STORAGE_KEY = 'blobbi:relay-sync:v1';
export const KNOWN_HEADS_STORAGE_KEY = 'blobbi:relay-heads:v1';
export const SYNC_CONSENT_STORAGE_KEY = 'blobbi:relay-sync-consent:v1';

/**
 * The newest revision of each of the player's own addresses this device has
 * seen accepted or read. Used for one thing: refusing to treat an OLDER
 * revision as current when the relay holding the newer one did not answer.
 */
export class KnownHeads {
  private readonly heads = new Map<string, { created_at: number; id: string }>();

  constructor(
    private readonly storage?: KeyValueStore,
    private readonly maxEntries = 200,
  ) {
    const saved = readJson<Record<string, [number, string]>>(storage, KNOWN_HEADS_STORAGE_KEY);
    for (const [address, value] of Object.entries(saved ?? {})) {
      if (Array.isArray(value) && Number.isFinite(value[0]) && typeof value[1] === 'string') {
        this.heads.set(address, { created_at: value[0], id: value[1] });
      }
    }
  }

  observe(event: NostrEvent): void {
    const address = eventAddress(event);
    if (!address) return;
    const held = this.heads.get(address);
    if (held && (held.id === event.id || !replacesEvent(event, held))) return;
    this.heads.delete(address);
    this.heads.set(address, { created_at: event.created_at, id: event.id });
    while (this.heads.size > this.maxEntries) {
      const oldest = this.heads.keys().next().value;
      if (oldest === undefined) break;
      this.heads.delete(oldest);
    }
    writeJson(
      this.storage,
      KNOWN_HEADS_STORAGE_KEY,
      Object.fromEntries([...this.heads].map(([key, head]) => [key, [head.created_at, head.id]])),
    );
  }

  list(): KnownHead[] {
    return [...this.heads].map(([address, head]) => ({ address, ...head }));
  }
}

// ── A queue the consumer can abandon ────────────────────────────────────────

class MessageQueue {
  private readonly items: RelayMessage[] = [];
  private wake: (() => void) | null = null;

  push(message: RelayMessage): void {
    this.items.push(message);
    this.wake?.();
  }

  /** Yields messages as they come; throws the signal's reason when it aborts (as `Machina` does). */
  async *drain(signal?: AbortSignal): AsyncGenerator<RelayMessage> {
    for (;;) {
      while (this.items.length > 0) yield this.items.shift()!;
      if (signal?.aborted) throw abortReason(signal);
      await new Promise<void>((resolve) => {
        const done = () => {
          signal?.removeEventListener('abort', done);
          this.wake = null;
          resolve();
        };
        this.wake = done;
        signal?.addEventListener('abort', done, { once: true });
      });
    }
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

// ── Carrying events to relays that lack them ────────────────────────────────

export interface RelaySyncOptions {
  deliver(event: NostrEvent, relay: string): Promise<DeliveryResult>;
  ledger: SyncLedger;
  status: RelayStatusStore;
  now: () => number;
  /** Deliveries allowed per rolling minute, over all relays. */
  perMinute: number;
  /** Deliveries in flight at once. */
  concurrency: number;
}

/**
 * The executor behind `planSync`: bounded, deduplicated, spaced.
 *
 * - a pair (event, relay) is in the queue at most once, and not at all when
 *   the ledger says it was accepted, refused, or is waiting out a backoff;
 * - at most `concurrency` deliveries at once and `perMinute` per minute, so a
 *   read that finds a hundred missing events does not become a hundred
 *   simultaneous publishes;
 * - a silent relay is retried when the ledger's backoff allows, up to the
 *   ledger's attempt limit; a refusal is not retried.
 */
export class RelaySync {
  private readonly queue: SyncTask<NostrEvent>[] = [];
  private readonly held = new Set<string>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly sentAt: number[] = [];
  private active = 0;
  private closed = false;

  constructor(private readonly options: RelaySyncOptions) {}

  enqueue(tasks: readonly SyncTask<NostrEvent>[]): void {
    if (this.closed) return;
    for (const task of tasks) {
      const key = SyncLedger.key(task.event.id, task.relay);
      if (this.held.has(key)) continue;
      const at = this.options.ledger.nextAttemptAt(task.event.id, task.relay);
      if (at === null) continue;
      // A refusal waits out its TTL; it is looked at again by a later read, not by a timer.
      if (this.options.ledger.get(task.event.id, task.relay)?.s === 'rejected' && at > this.options.now()) continue;
      this.held.add(key);
      if (at > this.options.now()) this.later(task, at - this.options.now());
      else this.queue.push(task);
    }
    this.pump();
  }

  /** A fresh publish left this relay silent: try again when the ledger allows. */
  retryLater(event: NostrEvent, relay: string): void {
    this.enqueue([{ event, relay, reason: 'missing' }]);
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.queue.length = 0;
  }

  private later(task: SyncTask<NostrEvent>, delayMs: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.closed) return;
      this.queue.push(task);
      this.pump();
    }, delayMs);
    this.timers.add(timer);
  }

  private pump(): void {
    while (!this.closed && this.active < this.options.concurrency && this.queue.length > 0) {
      const now = this.options.now();
      while (this.sentAt.length > 0 && now - this.sentAt[0] >= 60_000) this.sentAt.shift();
      if (this.sentAt.length >= this.options.perMinute) {
        const wait = 60_000 - (now - this.sentAt[0]);
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          this.pump();
        }, wait);
        this.timers.add(timer);
        return;
      }
      const task = this.queue.shift()!;
      this.sentAt.push(now);
      this.active += 1;
      void this.run(task).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async run(task: SyncTask<NostrEvent>): Promise<void> {
    const { ledger, status, now } = this.options;
    const key = SyncLedger.key(task.event.id, task.relay);
    const result = await this.options.deliver(task.event, task.relay);
    ledger.record(task.event.id, task.relay, result.verdict, result.message);
    status.recordDelivery(task.relay, result.verdict, {
      kind: task.event.kind,
      message: result.message,
      at: now(),
      carried: true,
    });
    status.setPending(task.relay, ledger.pending(task.relay).length);
    this.held.delete(key);
    if (result.verdict === 'retry') this.enqueue([task]);
  }
}

// ── The pool ────────────────────────────────────────────────────────────────

export interface IslandRelayPoolOptions {
  /** The player's current relay selection. Read on every call, so a change takes effect at once. */
  getConfig(): IslandRelayConfig;
  /** The signed-in account, or null. Only its own events are ever carried between relays. */
  getPubkey(): string | null;
  /** Open one relay connection. Tests pass fakes. */
  open?(url: string): NRelay;
  status?: RelayStatusStore;
  /** Where the ledger and the known heads persist. Defaults to `localStorage` when there is one. */
  storage?: KeyValueStore;
  now?: () => number;
  /** How long a non-empty answer is held back for relays that have not finished (ms). */
  settleMs?: number;
  /** After this long without EOSE a relay counts as not having answered (ms). */
  relayTimeoutMs?: number;
  /** Realtime reads end their stored phase this long after the first EOSE (ms). */
  liveGraceMs?: number;
  /** After the reader left, slow relays get this long to finish so they can still be compared (ms). */
  lingerMs?: number;
  /** One relay's budget to answer a publish (ms). */
  deliveryTimeoutMs?: number;
  /** How long a relay that failed is not waited for on non-empty answers (ms). */
  suspectMs?: number;
  /** Background deliveries per minute. */
  syncPerMinute?: number;
  /** Waits between retries of a relay that gave no verdict (ms). Defaults to the ledger's 30 s / 60 s / 120 s. */
  retryBackoffMs?: readonly number[];
}

interface MutableReadState {
  relay: string;
  status: 'pending' | 'eose' | 'failed';
  events: NostrEvent[];
}

function defaultStorage(): KeyValueStore | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export class IslandRelayPool extends NPool<NRelay> {
  readonly status: RelayStatusStore;
  readonly ledger: SyncLedger;
  readonly heads: KnownHeads;
  readonly sync: RelaySync;
  /** Which accounts chose to have their existing events carried, and to which relays. Off by default. */
  readonly consent: SyncConsent;
  private readonly consentListeners = new Set<() => void>();
  private consentVersion = 0;

  private readonly getConfig: () => IslandRelayConfig;
  private readonly getPubkey: () => string | null;
  private readonly now: () => number;
  private readonly settleMs: number;
  private readonly relayTimeoutMs: number;
  private readonly liveGraceMs: number;
  private readonly lingerMs: number;
  private readonly deliveryTimeoutMs: number;
  private readonly suspectMs: number;
  /** When each relay last failed to answer (ms). */
  private readonly failedAt = new Map<string, number>();
  private subscriptions = 0;

  constructor(options: IslandRelayPoolOptions) {
    const getConfig = options.getConfig;
    super({
      open: options.open ?? ((url: string) => new NRelay1(url)),
      // The routers below serve only code that reaches `NPool` behaviour
      // through `super` (an explicit `relays` option); the overrides do the
      // real routing.
      reqRouter: (filters) => routeFilters(filters, getConfig()),
      eventRouter: (event) => relaysForEvent(event, getConfig()),
    });
    this.getConfig = getConfig;
    this.getPubkey = options.getPubkey;
    this.now = options.now ?? Date.now;
    this.settleMs = options.settleMs ?? 1500;
    this.relayTimeoutMs = options.relayTimeoutMs ?? 6000;
    this.liveGraceMs = options.liveGraceMs ?? 350;
    this.lingerMs = options.lingerMs ?? 2500;
    this.deliveryTimeoutMs = options.deliveryTimeoutMs ?? 8000;
    this.suspectMs = options.suspectMs ?? 30_000;
    this.status = options.status ?? relayStatusStore;

    const storage = options.storage ?? defaultStorage();
    this.ledger = new SyncLedger({
      now: this.now,
      backoffMs: options.retryBackoffMs,
      initial: readJson<Record<string, SyncLedgerEntry>>(storage, SYNC_LEDGER_STORAGE_KEY),
      onChange: (entries) => writeJson(storage, SYNC_LEDGER_STORAGE_KEY, entries),
    });
    this.heads = new KnownHeads(storage);
    this.consent = new SyncConsent({
      now: this.now,
      initial: readJson<Record<string, SyncConsentRecord>>(storage, SYNC_CONSENT_STORAGE_KEY),
      onChange: (records) => {
        writeJson(storage, SYNC_CONSENT_STORAGE_KEY, records);
        this.consentVersion += 1;
        for (const listener of this.consentListeners) listener();
      },
    });
    this.sync = new RelaySync({
      deliver: (event, relay) => this.deliver(event, relay),
      ledger: this.ledger,
      status: this.status,
      now: this.now,
      perMinute: options.syncPerMinute ?? 30,
      concurrency: 2,
    });
  }

  private isSuspect(relay: string): boolean {
    const at = this.failedAt.get(relay);
    return at !== undefined && this.now() - at < this.suspectMs;
  }

  /** Whether a known head for this event is worth keeping: the player's own state. */
  private tracksHead(event: NostrEvent): boolean {
    return event.pubkey === this.getPubkey() && flowOfKind(event.kind) === 'state';
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  override async *req(
    filters: NostrFilter[],
    opts?: { signal?: AbortSignal; relays?: string[]; eoseTimeout?: number },
  ): AsyncGenerator<RelayMessage> {
    // An explicit relay list is the caller's own routing (NIP-46, the travel session): leave it alone.
    if (opts?.relays) {
      yield* super.req(filters, opts);
      return;
    }

    const config = this.getConfig();
    const routes = routeFilters(filters, config);
    if (routes.size === 0) return;

    const live = isRealtimeRead(filters);
    const subId = `island:${(this.subscriptions += 1)}`;
    const queue = new MessageQueue();
    const controller = new AbortController();
    const states = new Map<string, MutableReadState>();
    const emitted = new Set<string>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let decided = false;
    let graceStarted = false;
    let deadlinePassed = false;
    let readerGone = false;

    const emit = (event: NostrEvent) => {
      if (emitted.has(event.id)) return;
      emitted.add(event.id);
      queue.push(['EVENT', subId, event]);
    };

    const snapshot = (): RelayReadState<NostrEvent>[] =>
      [...states.values()].map((s) => ({ ...s, suspect: s.status === 'pending' && this.isSuspect(s.relay) }));

    const carry = () => {
      if (live) return;
      const pubkey = this.getPubkey();
      // A read stays a read until this account has chosen otherwise.
      if (!this.consent.isEnabled(pubkey)) return;
      const policy = withSyncConsent(islandSyncPolicy(config, pubkey), this.consent, pubkey);
      this.sync.enqueue(planSync<NostrEvent>({ states: snapshot(), filters, policy }));
    };

    const stopIfIdle = () => {
      if (readerGone && [...states.values()].every((s) => s.status !== 'pending')) controller.abort();
    };

    const evaluate = () => {
      if (decided) return;
      const all = [...states.values()];
      const pending = all.some((s) => s.status === 'pending');
      const answered = all.some((s) => s.status === 'eose');

      if (live) {
        // Realtime: events were already streamed; only the end of the stored phase is decided here.
        if (!pending) {
          decided = true;
          queue.push(answered ? ['EOSE', subId] : ['CLOSED', subId, 'error: no relay answered']);
        } else if (answered && !graceStarted) {
          graceStarted = true;
          const timer = setTimeout(() => {
            timers.delete(timer);
            if (decided) return;
            decided = true;
            queue.push(['EOSE', subId]);
          }, this.liveGraceMs);
          timers.add(timer);
        }
        return;
      }

      const decision = decideRead({ states: snapshot(), filters, deadlinePassed, knownHeads: this.heads.list() });
      if (decision.status === 'wait') return;
      decided = true;
      if (decision.status === 'unknown') {
        queue.push(['CLOSED', subId, `error: ${decision.reason}`]);
        return;
      }
      // Whoever is still silent now has been slower than the grace: do not hold the next read for it.
      for (const state of all) if (state.status === 'pending') this.failedAt.set(state.relay, this.now());
      for (const event of decision.events) {
        if (this.tracksHead(event)) this.heads.observe(event);
        emit(event);
      }
      queue.push(['EOSE', subId]);
    };

    const settle = (state: MutableReadState, status: 'eose' | 'failed') => {
      if (state.status !== 'pending') return;
      state.status = status;
      if (status === 'eose') this.failedAt.delete(state.relay);
      else if (!controller.signal.aborted) this.failedAt.set(state.relay, this.now());
      const wasDecided = decided;
      evaluate();
      if (wasDecided && status === 'eose') {
        // A relay that finished after the answer went out: its events still count, as late arrivals.
        for (const event of state.events) emit(event);
      }
      if (decided) carry();
      stopIfIdle();
    };

    const listen = async (state: MutableReadState, relayFilters: NostrFilter[]) => {
      const timeout = setTimeout(() => {
        timers.delete(timeout);
        settle(state, 'failed');
      }, this.relayTimeoutMs);
      timers.add(timeout);
      try {
        for await (const msg of this.relay(state.relay).req(relayFilters, { signal: controller.signal })) {
          if (msg[0] === 'EVENT') {
            // Kept for the merge until the answer goes out, and for a relay still to finish after it.
            if (state.status === 'pending' || !decided) state.events.push(msg[2]);
            if (live || decided) emit(msg[2]);
          } else if (msg[0] === 'EOSE') {
            clearTimeout(timeout);
            timers.delete(timeout);
            settle(state, 'eose');
          } else if (msg[0] === 'CLOSED') {
            break;
          }
        }
      } catch {
        // Unreachable, refused, or aborted by us: all of them are "did not answer".
      } finally {
        clearTimeout(timeout);
        timers.delete(timeout);
        settle(state, 'failed');
      }
    };

    for (const [relay, relayFilters] of routes) {
      const state: MutableReadState = { relay, status: 'pending', events: [] };
      states.set(relay, state);
      void listen(state, relayFilters);
    }

    const deadline = setTimeout(() => {
      timers.delete(deadline);
      deadlinePassed = true;
      evaluate();
      if (decided) carry();
    }, this.settleMs);
    timers.add(deadline);

    try {
      yield* queue.drain(opts?.signal);
    } finally {
      readerGone = true;
      clearTimeout(deadline);
      const pending = [...states.values()].some((s) => s.status === 'pending');
      if (live || !pending) {
        controller.abort();
      } else {
        // Give slow relays a moment to finish, so what they hold can still be compared and carried.
        setTimeout(() => controller.abort(), this.lingerMs);
      }
    }
  }

  override async query(filters: NostrFilter[], opts?: { signal?: AbortSignal; relays?: string[] }): Promise<NostrEvent[]> {
    if (opts?.relays) return super.query(filters, opts);
    if (filters.length > 0 && filters.every((filter) => filter.limit === 0)) return [];
    const events: NostrEvent[] = [];
    try {
      for await (const msg of this.req(filters, opts)) {
        if (msg[0] === 'EVENT') events.push(msg[2]);
        else break;
      }
    } catch {
      // Like `NPool.query`: an aborted read resolves with what it has instead of throwing.
    }
    return mergeRelayEvents(events);
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  /** Offer one event to one relay and classify the answer. Never throws. */
  private async deliver(event: NostrEvent, relay: string): Promise<DeliveryResult> {
    try {
      await this.relay(relay).event(event, { signal: AbortSignal.timeout(this.deliveryTimeoutMs) });
      this.failedAt.delete(relay);
      return { relay, verdict: 'accepted' };
    } catch (error) {
      if (isAbort(error)) {
        this.failedAt.set(relay, this.now());
        return { relay, verdict: 'retry', message: 'Timed out' };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { relay, verdict: classifyRejection(message), message };
    }
  }

  override async event(event: NostrEvent, opts?: { signal?: AbortSignal; relays?: string[] }): Promise<void> {
    if (opts?.relays) return super.event(event, opts);

    const config = this.getConfig();
    const relays = relaysForEvent(event, config);
    if (relays.length === 0) return;
    if (opts?.signal?.aborted) throw abortReason(opts.signal);

    const primary = normalizeRelayUrl(config.primary) ?? config.primary;
    const persistent = isSyncableEvent(event);
    const results: DeliveryResult[] = [];

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (act: () => void) => {
        if (settled) return;
        settled = true;
        opts?.signal?.removeEventListener('abort', onAbort);
        act();
      };
      const onAbort = () => finish(() => reject(abortReason(opts!.signal!)));
      opts?.signal?.addEventListener('abort', onAbort, { once: true });

      for (const relay of relays) {
        void this.deliver(event, relay).then((result) => {
          results.push(result);
          this.status.recordDelivery(relay, result.verdict, { kind: event.kind, message: result.message, at: this.now() });
          if (persistent) this.ledger.record(event.id, relay, result.verdict, result.message);

          if (result.verdict === 'accepted') {
            if (this.tracksHead(event)) this.heads.observe(event);
            finish(resolve);
          }
          if (results.length < relays.length) return;

          // Every relay has answered.
          const delivered = results.some((r) => r.verdict === 'accepted');
          if (!delivered) {
            const blamed = results.find((r) => r.relay === primary) ?? results[0];
            finish(() => reject(new Error(blamed.message ?? 'No relay accepted the event')));
            return;
          }
          // It landed somewhere. Relays that were silent get it later; a refusal stands.
          if (persistent) {
            for (const r of results) if (r.verdict === 'retry') this.sync.retryLater(event, r.relay);
          }
          for (const r of results) this.status.setPending(r.relay, this.ledger.pending(r.relay).length);
        });
      }
    });
  }

  /** For `useSyncExternalStore`: notified whenever any account's carrying choice changes. */
  subscribeConsent = (listener: () => void): (() => void) => {
    this.consentListeners.add(listener);
    return () => this.consentListeners.delete(listener);
  };

  getConsentVersion = (): number => this.consentVersion;

  /** Whether the signed-in account agreed to its existing events being copied to this relay. */
  mayCarryTo(relay: string): boolean {
    return this.consent.allows(this.getPubkey(), relay);
  }

  /** Every relay the current selection uses, primary first. */
  configuredRelays(): string[] {
    return allRelays(this.getConfig());
  }

  override async close(): Promise<void> {
    this.sync.close();
    await super.close();
  }
}
