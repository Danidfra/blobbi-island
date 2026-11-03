/**
 * What each relay last did with what the Island sent it, for the Network
 * panel and for anything that wants to say "saved, still syncing".
 *
 * A publication now goes to several relays, and "it worked" is no longer one
 * fact. The pool resolves a publish as soon as one relay holds the event; the
 * rest of the story (the primary was silent and will be retried, the primary
 * refused because the account is not on its write list) is recorded here, per
 * relay, instead of being thrown at the player as an error.
 *
 * In-memory and per tab. It is a status display, not a source of truth: the
 * delivery ledger (`SyncLedger`) is what actually prevents resends.
 */

import { normalizeRelayUrl, type DeliveryVerdict } from './relay-routing';

export interface RelayFailure {
  /** `rejected`: the relay refused. `retry`: no verdict; it will be tried again. */
  verdict: 'rejected' | 'retry';
  message: string;
  kind: number;
  at: number;
}

export interface RelayStatus {
  relay: string;
  /** When this relay last accepted an event from this tab (ms). */
  lastAcceptedAt?: number;
  /** The last event it did not take, cleared by the next one it accepts. */
  lastFailure?: RelayFailure;
  /** Events accepted elsewhere and still owed to this relay. */
  pending: number;
  /** Events this relay refused in this session. */
  refused: number;
  /** Events carried to this relay because a read found them missing here. */
  synced: number;
}

export type RelayStatusSnapshot = Readonly<Record<string, RelayStatus>>;

export class RelayStatusStore {
  private snapshot: RelayStatusSnapshot = Object.freeze({});
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RelayStatusSnapshot => this.snapshot;

  get(relay: string): RelayStatus | undefined {
    return this.snapshot[normalizeRelayUrl(relay) ?? relay];
  }

  private update(relay: string, change: (status: RelayStatus) => RelayStatus): void {
    const key = normalizeRelayUrl(relay) ?? relay;
    const current = this.snapshot[key] ?? { relay: key, pending: 0, refused: 0, synced: 0 };
    this.snapshot = Object.freeze({ ...this.snapshot, [key]: change(current) });
    for (const listener of this.listeners) listener();
  }

  /** One relay's verdict on one event. `carried` marks a sync delivery rather than a fresh publish. */
  recordDelivery(
    relay: string,
    verdict: DeliveryVerdict,
    detail: { kind: number; message?: string; at: number; carried?: boolean },
  ): void {
    this.update(relay, (status) => {
      if (verdict === 'accepted' || verdict === 'superseded') {
        return {
          ...status,
          lastAcceptedAt: detail.at,
          lastFailure: undefined,
          synced: status.synced + (detail.carried && verdict === 'accepted' ? 1 : 0),
        };
      }
      return {
        ...status,
        refused: status.refused + (verdict === 'rejected' ? 1 : 0),
        lastFailure: { verdict, message: detail.message ?? 'No answer', kind: detail.kind, at: detail.at },
      };
    });
  }

  /** How many events are still owed to this relay. */
  setPending(relay: string, pending: number): void {
    if ((this.get(relay)?.pending ?? 0) === pending) return;
    this.update(relay, (status) => ({ ...status, pending }));
  }
}

/** What a relay's status means to a player. Used by the Network panel. */
export function describeRelayStatus(
  status: RelayStatus | undefined,
): { text: string; tone: 'ok' | 'warn'; detail?: string } | null {
  if (!status) return null;
  const failure = status.lastFailure;
  if (failure?.verdict === 'rejected') {
    const writeList = /write list|pilot/i.test(failure.message);
    return {
      tone: 'warn',
      text: writeList
        ? 'Not accepting saves from this account yet. Your other relays have them.'
        : 'Refused the last save. Your other relays have it.',
      detail: failure.message,
    };
  }
  if (status.pending > 0 || failure?.verdict === 'retry') {
    const count = Math.max(status.pending, 1);
    return {
      tone: 'warn',
      text: `Not reachable just now. ${count} ${count === 1 ? 'save' : 'saves'} will sync later.`,
      detail: failure?.message,
    };
  }
  if (status.lastAcceptedAt) {
    return {
      tone: 'ok',
      text: status.synced > 0 ? `Up to date. Caught up on ${status.synced} earlier ${status.synced === 1 ? 'save' : 'saves'}.` : 'Up to date.',
    };
  }
  return null;
}

/** The one store the app's pool writes to and the Network panel reads. */
export const relayStatusStore = new RelayStatusStore();
