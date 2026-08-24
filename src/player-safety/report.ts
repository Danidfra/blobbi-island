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

const STORAGE_KEY = 'blobbi:safety:reports:v1';

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
export interface ReportedMessageEvidence {
  /**
   * The original signed event, verbatim.
   *
   * The strongest thing in a report: a reviewer can verify the signature and
   * know the reported pubkey really published it. An unverified copied string
   * proves nothing about who said it.
   */
  readonly sourceEvent: NostrEvent;
  /** `text` | `quick` | `template` | `emote`, as this build classified it. */
  readonly messageClass: string;
  /**
   * What this build actually put on screen.
   *
   * For a structured message the signed event carries only ids, which a reviewer
   * cannot read. This is the local reconstruction of what those ids meant.
   */
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
  readonly evidence?: ReportedMessageEvidence | null;
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
    evidence = {
      sourceEvent: event,
      messageClass: input.evidence.messageClass,
      renderedText: input.evidence.renderedText.slice(0, MAX_EVIDENCE_TEXT),
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
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PlayerReport =>
        !!entry && typeof entry === 'object' && typeof entry.reportedPubkey === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Append a report to the local store. Returns whether it was persisted.
 *
 * Bounded and oldest-first: an old report losing its place is an acceptable cost,
 * where dropping a block would not be (see `relationships.ts`).
 */
export function storeReport(report: PlayerReport): boolean {
  const next = [...readStored(), report].slice(-MAX_STORED_REPORTS);
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  return listReports().some((entry) => entry.id === report.id);
}

/** Every stored report, newest first. */
export function listReports(): readonly PlayerReport[] {
  return Object.freeze([...readStored()].sort((a, b) => b.createdAt - a.createdAt));
}

/** Forget every stored report. For tests and a future "clear my data" control. */
export function clearStoredReports(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** The storage key, exported so tests and documentation name it once. */
export const PLAYER_REPORT_STORAGE_KEY = STORAGE_KEY;
