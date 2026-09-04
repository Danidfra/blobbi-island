/**
 * Spend intents: the durable identity of ONE logical Coin purchase attempt.
 *
 * The wallet (`coin-wallet.ts`) is exactly-once **per opId**: a retried spend
 * that reuses its opId is reconciled in-lock and can never debit twice. What
 * the wallet cannot know is which USER GESTURES are the same logical purchase,
 * and before this module both spend surfaces minted a fresh random opId per
 * click, so retrying after an AMBIGUOUS outcome (the publish may have landed)
 * was an independent debit. This module closes that gap:
 *
 * ```
 *   user confirms a purchase
 *   → open (or reuse) the intent for this surface + payload   ← durable FIRST
 *   → spend with intent.intentId as the wallet opId
 *   → applied / already-applied  → deliver, then CLOSE the intent
 *   → ambiguous / blocked        → KEEP the intent: the next confirm of the
 *                                  same purchase reuses the SAME opId, and the
 *                                  wallet reconciles instead of re-debiting
 *   → provably-unsent failure    → keep; reusing an unsent opId is harmless
 * ```
 *
 * An intent is matched by surface + amount + normalized grant lines, but ONLY
 * while it is open. Closing on definitive completion is what lets the same
 * cart be bought again intentionally later with a fresh identity; the payload
 * is never a permanent idempotency key.
 *
 * ## Storage lifetime matches DELIVERY lifetime
 *
 * Intents live in **localStorage**, because what they deliver is durable: the
 * items and the charge land atomically in the kind:31633 event, so the open
 * question ("did my purchase land?") survives reloads and must keep its
 * identity.
 *
 * There was briefly a second, sessionStorage-backed surface for the old
 * visit-scoped Arcade Pass, whose delivery really did end with the tab. Nothing
 * is tab-scoped any more, the Arcade Pass is a 24-hour entitlement redeemed
 * with Arcade Tickets, not a Coin purchase, so the split is gone rather than
 * kept warm for a hypothetical caller.
 *
 * Writes are read-back verified, like the Coin-op ledger: a caller that cannot
 * durably record the intent MUST NOT charge, an unrecorded ambiguous spend is
 * exactly the unretriable double-debit this module exists to prevent.
 *
 * ## Bounds
 *
 * Opening an intent garbage-collects its surface: intents whose Coin-op record
 * is missing or provably unsent (`prepared`/`failed`) are deleted unless they
 * match the requested payload, and CLOSED-but-lingering `applied` intents are
 * pruned after {@link APPLIED_INTENT_RETENTION_MS}. Possibly-published intents
 * (`publishing`/`ambiguous`) are never garbage-collected; each one is a real
 * open question about the player's balance.
 */

import { readCoinOp, type CoinOpRecord } from './coin-op-ledger';

/**
 * Which flow a spend belongs to. One member today; kept as a named union
 * because it namespaces intents in storage, and a second Coin surface would
 * otherwise silently match the first one's open intents.
 */
export type SpendSurface = 'shop-purchase';

export interface SpendIntentLine {
  readonly address: string;
  readonly amount: number;
}

export interface SpendIntent {
  /** Also the wallet opId; one identity for the whole logical purchase. */
  readonly intentId: string;
  readonly surface: SpendSurface;
  /** Total Coin cost of the purchase. */
  readonly amount: number;
  /** Normalized item grants. */
  readonly lines: readonly SpendIntentLine[];
  readonly createdAt: number;
}

export interface OpenSpendIntentInput {
  readonly surface: SpendSurface;
  readonly amount: number;
  readonly lines?: readonly SpendIntentLine[];
}

const LOCAL_KEY = 'blobbi:coin:spend-intents';

/**
 * How long a definitively-`applied` intent that its flow never closed (e.g. a
 * recovery pass proved the purchase landed but the player never retried) may
 * linger before it is pruned. Until then, confirming the same purchase again
 * resolves as `already-applied` instead of charging twice; after two weeks, an
 * identical purchase is unambiguously a new one.
 */
export const APPLIED_INTENT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

type IntentStore = Record<string, Record<string, SpendIntent>>;

function storageFor(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isLine(value: unknown): value is SpendIntentLine {
  if (!value || typeof value !== 'object') return false;
  const line = value as Partial<SpendIntentLine>;
  return typeof line.address === 'string' && typeof line.amount === 'number';
}

function isIntent(value: unknown): value is SpendIntent {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Partial<SpendIntent>;
  return (
    typeof intent.intentId === 'string' &&
    intent.surface === 'shop-purchase' &&
    typeof intent.amount === 'number' &&
    Array.isArray(intent.lines) &&
    intent.lines.every(isLine) &&
    typeof intent.createdAt === 'number'
  );
}

function readStore(surface: SpendSurface): IntentStore {
  try {
    const storage = storageFor();
    if (!storage) return {};
    const raw = storage.getItem(LOCAL_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const store: IntentStore = {};
    for (const [pubkey, intents] of Object.entries(parsed as Record<string, unknown>)) {
      if (!intents || typeof intents !== 'object' || Array.isArray(intents)) continue;
      const kept: Record<string, SpendIntent> = {};
      for (const [intentId, intent] of Object.entries(intents as Record<string, unknown>)) {
        if (isIntent(intent) && intent.surface === surface) kept[intentId] = intent;
      }
      store[pubkey] = kept;
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(store: IntentStore): boolean {
  try {
    const storage = storageFor();
    if (!storage) return false;
    storage.setItem(LOCAL_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

function normalizeLines(
  lines: readonly SpendIntentLine[] | undefined,
): SpendIntentLine[] {
  return [...(lines ?? [])]
    .map((line) => ({ address: line.address, amount: line.amount }))
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
}

function sameLines(
  a: readonly SpendIntentLine[],
  b: readonly SpendIntentLine[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (line, index) => line.address === b[index].address && line.amount === b[index].amount,
  );
}

function matches(intent: SpendIntent, input: OpenSpendIntentInput): boolean {
  return (
    intent.surface === input.surface &&
    intent.amount === input.amount &&
    sameLines(intent.lines, normalizeLines(input.lines))
  );
}

/** May a garbage collector drop this intent? Never a possibly-published one. */
function isCollectible(record: CoinOpRecord | null, intent: SpendIntent, now: number): boolean {
  if (!record || record.status === 'prepared' || record.status === 'failed') {
    // Provably unsent (or never even attempted): dropping it cannot lose money.
    return true;
  }
  if (record.status === 'applied') {
    // Definitively complete but never closed by its flow; see the retention doc.
    return now - intent.createdAt > APPLIED_INTENT_RETENTION_MS;
  }
  return false; // publishing / ambiguous: a real open question, never dropped.
}

/** Every open intent for this pubkey + surface, oldest first. */
export function openSpendIntentsFor(
  pubkey: string | undefined,
  surface: SpendSurface,
): SpendIntent[] {
  if (!pubkey) return [];
  return Object.values(readStore(surface)[pubkey] ?? {}).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
}

export interface OpenedSpendIntent {
  readonly intent: SpendIntent;
  /** True when an existing open intent for the same purchase was reused. */
  readonly reused: boolean;
}

/**
 * Open the intent for one logical purchase, reusing the existing open intent
 * when this is a retry of the same purchase (same surface, amount and lines).
 *
 * `mintId` supplies the identity for a NEW intent (the caller's opId minting,
 * e.g. `mintCoinOpId(surface)`), so intent ids and wallet op ids stay one
 * namespace.
 *
 * Returns `null` when the intent could not be durably stored (verified by
 * read-back). A caller getting `null` MUST NOT charge: without the record, an
 * ambiguous publish could not be safely retried.
 */
export function openSpendIntent(
  pubkey: string | undefined,
  input: OpenSpendIntentInput,
  mintId: () => string,
  now: () => number = Date.now,
): OpenedSpendIntent | null {
  if (!pubkey) return null;
  const surface = input.surface;
  const store = readStore(surface);
  const owned = { ...(store[pubkey] ?? {}) };
  const timestamp = now();

  // Garbage-collect this surface first, so abandoned unsent intents are
  // bounded, then pick the retry target:
  // - applied-and-aged past retention is pruned even when it matches, an
  //   ancient completed purchase must never capture a genuinely new
  //   identical one;
  // - otherwise a MATCHING intent is reused, including one with no wallet
  //   record yet: that is either the in-flight attempt of this very purchase
  //   (so two rapid confirms share one opId and the wallet's exactly-once
  //   check settles them) or a provably-unsent leftover, which is harmless
  //   to reuse;
  // - non-matching intents are collected when provably unsent or aged out;
  //   possibly-published ones are always kept.
  let reusable: SpendIntent | null = null;
  for (const intent of Object.values(owned).sort((a, b) => a.createdAt - b.createdAt)) {
    const record = readCoinOp(pubkey, intent.intentId);
    const agedApplied =
      record?.status === 'applied' &&
      timestamp - intent.createdAt > APPLIED_INTENT_RETENTION_MS;
    if (agedApplied) {
      delete owned[intent.intentId];
      continue;
    }
    if (matches(intent, input)) {
      reusable = reusable ?? intent;
      continue;
    }
    if (isCollectible(record, intent, timestamp)) {
      delete owned[intent.intentId];
    }
  }

  if (reusable) {
    store[pubkey] = owned;
    // Best-effort persistence of the GC; the reused record itself is already
    // durably stored, so a failed write here does not endanger the retry.
    writeStore(store);
    return { intent: reusable, reused: true };
  }

  const intent: SpendIntent = {
    intentId: mintId(),
    surface,
    amount: input.amount,
    lines: normalizeLines(input.lines),
    createdAt: timestamp,
  };
  owned[intent.intentId] = intent;
  store[pubkey] = owned;
  if (!writeStore(store)) return null;

  // Read back: storage that silently dropped the write must refuse the charge.
  const stored = readStore(surface)[pubkey]?.[intent.intentId];
  if (!stored || stored.intentId !== intent.intentId) return null;
  return { intent, reused: false };
}

/**
 * Close an intent after its purchase DEFINITIVELY completed and delivered
 * (`applied`/`already-applied`, plus: for the pass, the pass actually
 * stored). Closing is what gives the next identical purchase a fresh identity.
 */
export function closeSpendIntent(
  pubkey: string | undefined,
  surface: SpendSurface,
  intentId: string,
): boolean {
  if (!pubkey) return false;
  const store = readStore(surface);
  const owned = { ...(store[pubkey] ?? {}) };
  delete owned[intentId];
  store[pubkey] = owned;
  return writeStore(store);
}

/** Tests and the DEV harness only. */
export function clearSpendIntents(pubkey?: string): void {
  for (const surface of ['shop-purchase'] as const) {
    try {
      const storage = storageFor();
      if (!storage) continue;
      if (!pubkey) {
        storage.removeItem(LOCAL_KEY);
        continue;
      }
      const store = readStore(surface);
      delete store[pubkey];
      writeStore(store);
    } catch {
      /* nothing to clear */
    }
  }
}
