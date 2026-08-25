/**
 * Reports: capturing what happened, while it still exists.
 *
 * ## Why capture at all
 *
 * Island communication is kind 21201 — ephemeral, with a ~10 second NIP-40
 * expiration. By the time anyone looks at a report, the event it is about is
 * gone from the relay and gone from this client. A report that only says "this
 * player, this category" is a report nobody can act on and nobody can check.
 *
 * So a report taken about a message captures the message: the **signed original
 * event**, plus what this build actually rendered from it. Both, because they
 * answer different questions. The signed event is verifiable — anyone can check
 * the signature and confirm that pubkey really said it — but for a structured
 * message it is only ids (`{"type":"quick","phrase":"hi"}`), which means nothing
 * to a reviewer. The rendered text is readable but unverifiable on its own.
 * Together they are evidence; either alone is half of it.
 *
 * ## Data minimisation is a rule here, not an aspiration
 *
 * A report captures the reported player, the category, the one message, and
 * where and when it happened. It deliberately does NOT capture movement history,
 * the room's other messages, who else was present, the reporter's session, or
 * anything about the wider world. A safety feature that hoovers up context is a
 * surveillance feature wearing a helpful label, and this one is used by children.
 *
 * ## Where reports go today: nowhere
 *
 * They are stored locally and nothing publishes them. That is stated here
 * because the alternative — implying a moderation team exists — would be a lie
 * told to a child at the moment they most need to be told the truth. See
 * `docs/player-safety-controls.md` for the standards analysis behind that, and
 * for what would have to exist before publication makes sense.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import { scopedSafetyKey, subscribeSafetyAccount } from './account-scope';

const STORAGE_KEY = 'blobbi:safety:reports:v1';

/** The schema this build writes and the ONLY one it reads. See {@link readStored}. */
const REPORT_SCHEMA_VERSION = 1;

/**
 * A window in which the same report from the same reporter is the same report.
 *
 * A double-tapped button, a retry after a slow save, a re-submit of a dialog
 * that did not visibly close — none of those are two complaints, and a store
 * capped at fifty cannot afford to treat them as such.
 */
const DEDUPE_WINDOW_MS = 60_000;

/** Signed-out reports: memory only, never persisted, never inherited. */
let memoryReports: string | null = null;

/** Where this account's reports live, or `null` for the memory store. */
function reportsKey(): string | null {
  return scopedSafetyKey(STORAGE_KEY);
}

function readRawReports(): string | null {
  const key = reportsKey();
  if (key === null) return memoryReports;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRawReports(serialized: string | null): boolean {
  const key = reportsKey();
  if (key === null) {
    memoryReports = serialized;
    return true;
  }
  try {
    if (typeof localStorage === 'undefined') return false;
    if (serialized === null) localStorage.removeItem(key);
    else localStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

/** Validate one stored record. Anything that fails is dropped, not repaired. */
function parseStoredReport(value: unknown): PlayerReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;

  if (typeof entry.id !== 'string' || !entry.id) return null;
  if (typeof entry.reportedPubkey !== 'string' || !PUBKEY_PATTERN.test(entry.reportedPubkey)) {
    return null;
  }
  const reporter = entry.reporterPubkey;
  if (reporter !== null && (typeof reporter !== 'string' || !PUBKEY_PATTERN.test(reporter))) {
    return null;
  }
  const category = reportCategoryById(String(entry.category));
  if (!category) return null;
  if (typeof entry.createdAt !== 'number' || !Number.isFinite(entry.createdAt)) return null;

  const rawEvidence = entry.evidence;
  let evidence: ReportedMessageEvidence | null = null;
  if (rawEvidence && typeof rawEvidence === 'object' && !Array.isArray(rawEvidence)) {
    const record = rawEvidence as Record<string, unknown>;
    // A record written by an older build carried the whole signed event. It is
    // not migrated: the fields below are what a report is now, and anything a
    // legacy blob had beyond them is exactly what this phase stopped keeping.
    if (typeof record.eventId === 'string' && typeof record.authorPubkey === 'string') {
      evidence = {
        eventId: record.eventId.slice(0, 64),
        authorPubkey: record.authorPubkey.toLowerCase().slice(0, 64),
        createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
        messageClass: String(record.messageClass ?? '').slice(0, 32),
        renderedText: String(record.renderedText ?? '').slice(0, MAX_EVIDENCE_TEXT),
      };
    }
  }

  return Object.freeze({
    id: entry.id.slice(0, 64),
    createdAt: entry.createdAt,
    reportedPubkey: entry.reportedPubkey.toLowerCase(),
    reporterPubkey: typeof reporter === 'string' ? reporter.toLowerCase() : null,
    category: category.id,
    nip56Type: category.nip56Type,
    islandId: String(entry.islandId ?? '').slice(0, 64),
    location: String(entry.location ?? '').slice(0, 64),
    evidence,
  });
}

/** Reports kept locally. Oldest are dropped first. */
export const MAX_STORED_REPORTS = 50;

/** Kind 21201 — the only event class a report may carry as evidence today. */
const COMMUNICATION_KIND = 21201;

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/i;

/** Hard bound on captured text, so a hostile payload cannot bloat the store. */
const MAX_EVIDENCE_TEXT = 500;

/**
 * What the player says happened, in words a child can pick between.
 *
 * Five, deliberately. A longer list is a form, and a form is the thing a
 * distressed nine-year-old abandons.
 */
export type ReportCategory = 'mean' | 'inappropriate' | 'spam' | 'unsafe' | 'other';

export interface ReportCategorySpec {
  readonly id: ReportCategory;
  /** What the player reads. */
  readonly label: string;
  /** One line of clarification under the label. */
  readonly description: string;
  /**
   * The NIP-56 report type this maps to, recorded on every report so a stored
   * report is directly translatable if publication is ever built.
   *
   * The mapping is lossy in one direction that matters: **NIP-56 has no report
   * type for grooming or predatory contact.** Its vocabulary — nudity, malware,
   * profanity, illegal, spam, impersonation, other — predates child-safety use
   * cases, so the category children most need lands on `other`. The precise
   * meaning survives in {@link PlayerReport.category}, and NIP-32 labels (which
   * NIP-56 explicitly allows) are where it would go on the wire.
   */
  readonly nip56Type: 'nudity' | 'profanity' | 'spam' | 'other';
}

export const REPORT_CATEGORIES: readonly ReportCategorySpec[] = Object.freeze([
  {
    id: 'mean',
    label: 'Being mean',
    description: 'Bullying, insults or unkind messages',
    nip56Type: 'profanity',
  },
  {
    id: 'inappropriate',
    label: 'Rude content',
    description: 'Grown-up or inappropriate things',
    nip56Type: 'nudity',
  },
  {
    id: 'spam',
    label: 'Spam',
    description: 'The same thing over and over',
    nip56Type: 'spam',
  },
  {
    id: 'unsafe',
    label: 'Made me feel unsafe',
    description: 'Asking personal questions, or to talk somewhere else',
    nip56Type: 'other',
  },
  {
    id: 'other',
    label: 'Something else',
    description: 'Anything not on this list',
    nip56Type: 'other',
  },
]);

const CATEGORY_BY_ID: ReadonlyMap<string, ReportCategorySpec> = new Map(
  REPORT_CATEGORIES.map((category) => [category.id, category]),
);

export function reportCategoryById(id: string): ReportCategorySpec | null {
  return CATEGORY_BY_ID.get(id) ?? null;
}

/** The message a report is about, captured at report time. */
/**
 * What a report keeps about the message it is about.
 *
 * ## Minimal on purpose
 *
 * This used to be the whole signed event, verbatim — content, every tag, the
 * signature. That is an attacker-controlled blob written to a child's device
 * because they asked for help, and almost none of it was ever read: nothing in
 * this build verifies a signature, and there is no reviewer to verify one for.
 *
 * So it keeps the four things a report actually needs and nothing else. The
 * event id is a POINTER: if a destination for reports ever exists, it can fetch
 * the original from a relay and verify it there, which is a better story than a
 * local copy nobody checked.
 *
 * ## What is deliberately absent
 *
 * `content`, `tags` and `sig`. Their absence is the feature — see §C of
 * `docs/family-activation-readiness.md`.
 */
export interface ReportedMessageEvidence {
  /** The reported event's id. A pointer for a future reviewer, not a proof. */
  readonly eventId: string;
  /** Its author, which the builder has already checked is the reported player. */
  readonly authorPubkey: string;
  /** When they said it, from the event. Seconds, as Nostr stores it. */
  readonly createdAt: number;
  /** `text` | `quick` | `template` | `emote`, as this build classified it. */
  readonly messageClass: string;
  /**
   * What this build actually put on screen, capped.
   *
   * For a structured message the signed event carries only ids, which nobody
   * can read back. This is the local reconstruction of what those ids meant —
   * and for a free-text message it is the only readable record, which is why it
   * is attached only when the reporter explicitly chose to include it.
   */
  readonly renderedText: string;
}

/** The raw event a caller offers as evidence, before it is reduced. */
export interface ReportEvidenceCandidate {
  readonly sourceEvent: NostrEvent;
  readonly messageClass: string;
  readonly renderedText: string;
}

export interface PlayerReport {
  readonly id: string;
  readonly createdAt: number;
  readonly reportedPubkey: string;
  /** The reporter, when known. Recorded locally; never published by this build. */
  readonly reporterPubkey: string | null;
  readonly category: ReportCategory;
  /** NIP-56 equivalent, stored so the record stays translatable. */
  readonly nip56Type: string;
  /** Where it happened, at room granularity. Never a coordinate. */
  readonly islandId: string;
  readonly location: string;
  /** The message, when the report is about one. `null` for a report about a player. */
  readonly evidence: ReportedMessageEvidence | null;
}

export type ReportBuildFailure =
  | 'invalid-pubkey'
  | 'self-report'
  | 'unknown-category'
  | 'evidence-wrong-kind'
  | 'evidence-wrong-author'
  | 'evidence-missing-id';

export type ReportBuildResult =
  | { readonly ok: true; readonly report: PlayerReport }
  | { readonly ok: false; readonly reason: ReportBuildFailure };

export interface BuildPlayerReportInput {
  readonly reportedPubkey: string;
  readonly reporterPubkey?: string | null;
  readonly category: string;
  readonly islandId: string;
  readonly location: string;
  readonly evidence?: ReportEvidenceCandidate | null;
  /** Injected so tests do not depend on a clock. */
  readonly now?: number;
  /** Injected so tests do not depend on a random source. */
  readonly id?: string;
}

function newReportId(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid;
  } catch {
    /* fall through */
  }
  return `report-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Validate and assemble a report. Pure — it stores nothing and publishes nothing.
 *
 * The evidence checks are the interesting ones. A report may only carry a kind
 * 21201 event, and that event's author **must be the player being reported**:
 * without that check a client could attach somebody else's signed message to a
 * report about a third party, which would turn the evidence — the one part of a
 * report that is verifiable — into a way to frame people.
 */
export function buildPlayerReport(input: BuildPlayerReportInput): ReportBuildResult {
  if (!PUBKEY_PATTERN.test(input.reportedPubkey ?? '')) {
    return { ok: false, reason: 'invalid-pubkey' };
  }

  /*
    You cannot report yourself.

    Rejected here rather than in the dialog, because the dialog is not the only
    caller and self-reports are pure noise in a store that is bounded: fifty of
    them evict fifty real ones.
  */
  if (
    input.reporterPubkey &&
    input.reporterPubkey.toLowerCase() === input.reportedPubkey.toLowerCase()
  ) {
    return { ok: false, reason: 'self-report' };
  }

  const category = reportCategoryById(input.category);
  if (!category) return { ok: false, reason: 'unknown-category' };

  let evidence: ReportedMessageEvidence | null = null;
  if (input.evidence) {
    const event = input.evidence.sourceEvent;
    if (!event?.id) return { ok: false, reason: 'evidence-missing-id' };
    if (event.kind !== COMMUNICATION_KIND) return { ok: false, reason: 'evidence-wrong-kind' };
    if (event.pubkey?.toLowerCase() !== input.reportedPubkey.toLowerCase()) {
      return { ok: false, reason: 'evidence-wrong-author' };
    }
    /*
      REDUCED HERE, at the boundary — the raw event never reaches storage.

      Everything the report needs is derived from fields this builder has
      already validated; `content`, `tags` and `sig` are dropped on the floor.
      A caller cannot opt out of that by passing a bigger object, because the
      stored shape has nowhere to put one.
    */
    evidence = {
      eventId: event.id,
      authorPubkey: event.pubkey.toLowerCase(),
      createdAt: typeof event.created_at === 'number' ? event.created_at : 0,
      messageClass: String(input.evidence.messageClass ?? '').slice(0, 32),
      renderedText: String(input.evidence.renderedText ?? '').slice(0, MAX_EVIDENCE_TEXT),
    };
  }

  return {
    ok: true,
    report: Object.freeze({
      id: input.id ?? newReportId(),
      createdAt: input.now ?? Date.now(),
      reportedPubkey: input.reportedPubkey.toLowerCase(),
      reporterPubkey: input.reporterPubkey?.toLowerCase() ?? null,
      category: category.id,
      nip56Type: category.nip56Type,
      islandId: input.islandId,
      location: input.location,
      evidence,
    }),
  };
}

// ── Local persistence ───────────────────────────────────────────────────────

function readStored(): PlayerReport[] {
  const raw = readRawReports();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);

    /*
      A BARE ARRAY is the shape that shipped before the version tag; a
      versioned object is this one. Anything else — a `v: 2` written by a build
      that keeps different fields — yields an EMPTY list rather than being
      read as though it were this schema. Interpreting a future record with
      today's rules is how a report about one player ends up filed against
      another.
    */
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && (parsed as { v?: unknown }).v === REPORT_SCHEMA_VERSION
        ? ((parsed as { reports?: unknown }).reports ?? [])
        : null;
    if (!Array.isArray(entries)) return [];

    // Bounded before parsing: a store that grew past the cap (by hand, or by an
    // older build) must not become an unbounded parse.
    return entries
      .slice(-MAX_STORED_REPORTS)
      .map(parseStoredReport)
      .filter((entry): entry is PlayerReport => entry !== null);
  } catch {
    return [];
  }
}

/**
 * Is this the same complaint we already have?
 *
 * Same reporter, same target, same category and same evidence, inside a minute.
 * Deliberately NOT keyed on the report id: a retry mints a new id, which is
 * exactly the case this exists for. Two genuinely different complaints differ
 * in category or in the message they point at, and both still get through.
 */
function duplicateOf(existing: readonly PlayerReport[], report: PlayerReport): boolean {
  return existing.some(
    (entry) =>
      entry.reportedPubkey === report.reportedPubkey &&
      entry.reporterPubkey === report.reporterPubkey &&
      entry.category === report.category &&
      (entry.evidence?.eventId ?? null) === (report.evidence?.eventId ?? null) &&
      Math.abs(entry.createdAt - report.createdAt) < DEDUPE_WINDOW_MS,
  );
}

/**
 * Append a report to the local store. Returns whether it was persisted.
 *
 * Bounded and oldest-first: an old report losing its place is an acceptable cost,
 * where dropping a block would not be (see `relationships.ts`).
 */
export function storeReport(report: PlayerReport): boolean {
  const existing = readStored();
  // A duplicate is a SUCCESS, not a write: the player's complaint is on record,
  // which is the only thing the answer is about.
  if (duplicateOf(existing, report)) return true;

  const next = [...existing, report].slice(-MAX_STORED_REPORTS);
  if (!writeRawReports(JSON.stringify({ v: REPORT_SCHEMA_VERSION, reports: next }))) return false;

  // Read back rather than trust `setItem`: it can throw, and in hardened
  // environments it can silently do nothing. The caller shows the player an
  // outcome, so the outcome has to be checked.
  return listReports().some((entry) => entry.id === report.id);
}

/** Every stored report, newest first. */
export function listReports(): readonly PlayerReport[] {
  return Object.freeze([...readStored()].sort((a, b) => b.createdAt - a.createdAt));
}

/** Forget every stored report. For tests and a future "clear my data" control. */
export function clearStoredReports(): void {
  writeRawReports(null);
}

/** The storage key, exported so tests and documentation name it once. */
export const PLAYER_REPORT_STORAGE_KEY = STORAGE_KEY;

/*
  Switching account switches the reports, and drops the signed-out ones.

  The store reads through `reportsKey()` on every call, so there is no cache to
  invalidate — but the memory bucket must not survive into the account that
  just signed in, which is the leak `account-scope.ts` exists to close.
*/
subscribeSafetyAccount(() => {
  memoryReports = null;
});
