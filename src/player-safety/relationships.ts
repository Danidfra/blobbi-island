/**
 * The canonical store of local player-safety relationships.
 *
 * One record per pubkey, two independent bits, one place. Everything that
 * enforces Mute or Block — the presence ingest, the communication ingest, the
 * settings list, the action sheet — reads this module and nothing else. A
 * second store would be a second answer to "is this player blocked?", and the
 * two would disagree on exactly the event that mattered.
 *
 * ## Why this lives outside `src/safety/`
 *
 * `src/safety/` answers *what may this EXPERIENCE do* — a capability matrix
 * that is deliberately pure, deliberately ambient-state-free, and asserted to be
 * so by its own boundary test. This module answers a different question: *what
 * has this PLAYER decided about that PLAYER*. It is per-person, mutable, and
 * necessarily backed by storage. Folding it into the capability layer would
 * mean relaxing the invariant that makes the capability layer trustworthy.
 *
 * They compose without depending on each other: a capability decides whether a
 * class of message may be shown at all, a relationship decides whether this
 * sender's messages may be shown. Both gates sit on the same ingest path.
 *
 * ## Local-first, and why enforcement never waits for a relay
 *
 * Pressing Block must make someone disappear NOW. A relay round trip is
 * hundreds of milliseconds on a good connection and unbounded on a bad one, and
 * "the person harassing you is still on screen while we publish" is not an
 * acceptable failure mode. So the local write IS the enforcement, and any future
 * Nostr synchronisation (see `docs/player-safety-controls.md`) is durability and
 * interoperability layered on top — never a precondition.
 *
 * ## Cross-tab propagation is free here
 *
 * `localStorage` fires a `storage` event in every OTHER document of the same
 * origin. Same-tab writes notify subscribers directly (storage events do not
 * fire in the writing tab). Together that is live cross-tab propagation with no
 * BroadcastChannel and no second synchronisation mechanism — the same shape
 * `arcade-pass.ts` already uses, pointed at `localStorage` because a block must
 * outlive the tab that made it.
 *
 * ## Failure behaviour, chosen deliberately
 *
 * Every read is guarded and every parse is tolerant: unreadable or corrupt
 * storage reads as "no relationships" rather than throwing, because this module
 * runs inside the multiplayer receive loop where an exception would take down
 * the subscription for the whole room.
 *
 * That failure direction is worth stating plainly, because it is the unsafe one:
 * a corrupt store forgets that someone was blocked. The alternative — refusing
 * to render anything until storage can be read — fails the entire game closed
 * for a problem that is almost always "private browsing". The mitigation is that
 * writes read back (see {@link write}), so a store that cannot persist reports
 * failure to the caller at the moment the player presses Block, rather than
 * silently forgetting later.
 */

const STORAGE_KEY = 'blobbi:safety:relationships:v1';

/**
 * Soft cap on tracked players.
 *
 * A relationship is ~70 bytes, so this is nowhere near a storage limit; the cap
 * exists so a pathological session cannot grow the record without bound.
 *
 * **It never evicts a block.** When the store is full a new entry displaces the
 * oldest MUTE-only relationship, and if every entry is a block the store is
 * allowed to exceed the cap instead. Dropping a block to satisfy a size limit
 * would silently restore someone the player removed, which is the one outcome
 * this whole module exists to prevent.
 */
export const MAX_TRACKED_PLAYERS = 500;

/** A hex pubkey, loosely validated — enough to reject obvious junk. */
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/i;

/** What this player has decided about one other player. */
export interface PlayerRelationship {
  /** Their communication is not shown. They remain visible. */
  readonly muted: boolean;
  /** They are removed from this player's experience entirely. */
  readonly blocked: boolean;
}

/** A relationship plus who it is about and when it was last changed. */
export interface PlayerSafetyEntry extends PlayerRelationship {
  readonly pubkey: string;
  /** Unix milliseconds of the last change. Used for ordering and eviction. */
  readonly at: number;
}

/** The neutral relationship. A frozen singleton, so callers can compare by identity. */
export const NO_RELATIONSHIP: PlayerRelationship = Object.freeze({ muted: false, blocked: false });

/** The stored shape. Short keys because this is written on every change. */
interface StoredEntry {
  m?: 1;
  b?: 1;
  at?: number;
}

type StoredMap = Record<string, StoredEntry>;

const listeners = new Set<() => void>();
let storageListenerAttached = false;

/**
 * The parsed snapshot, cached against the exact string it came from.
 *
 * `useSyncExternalStore` requires a snapshot that is referentially stable
 * between renders unless it genuinely changed. Re-parsing on every call would
 * return a new object every time and re-render forever.
 */
let cache: { raw: string | null; map: StoredMap; entries: readonly PlayerSafetyEntry[] } | null =
  null;

function readRaw(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Tolerant parse: anything unexpected becomes an empty store rather than a throw. */
function parse(raw: string | null): StoredMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const players = (parsed as { players?: unknown }).players;
    if (!players || typeof players !== 'object' || Array.isArray(players)) return {};

    const out: StoredMap = {};
    for (const [pubkey, value] of Object.entries(players as Record<string, unknown>)) {
      if (!PUBKEY_PATTERN.test(pubkey)) continue;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      const muted = entry.m === 1;
      const blocked = entry.b === 1;
      // A record that says nothing is not a record. Dropping it keeps the store
      // from accumulating tombstones as players unmute and unblock.
      if (!muted && !blocked) continue;
      out[pubkey.toLowerCase()] = {
        ...(muted ? { m: 1 as const } : {}),
        ...(blocked ? { b: 1 as const } : {}),
        at: typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function toEntries(map: StoredMap): readonly PlayerSafetyEntry[] {
  return Object.freeze(
    Object.entries(map)
      .map(([pubkey, entry]) => ({
        pubkey,
        muted: entry.m === 1,
        blocked: entry.b === 1,
        at: entry.at ?? 0,
      }))
      // Newest first: the settings list should open on what was just changed.
      .sort((a, b) => b.at - a.at),
  );
}

function current(): { map: StoredMap; entries: readonly PlayerSafetyEntry[] } {
  const raw = readRaw();
  if (cache && cache.raw === raw) return cache;
  const map = parse(raw);
  cache = { raw, map, entries: toEntries(map) };
  return cache;
}

function emit(): void {
  // Copy first: a listener that unsubscribes during notification must not
  // perturb the iteration.
  [...listeners].forEach((listener) => listener());
}

/**
 * Persist a new map and report whether it actually stuck.
 *
 * The read-back matters for the same reason it does in `arcade-pass.ts`:
 * `setItem` can throw or, in hardened environments, silently do nothing.
 * "It didn't throw" is not "it is stored", and here the difference is whether a
 * player who pressed Block is protected after a reload. The caller surfaces the
 * failure rather than showing a success it cannot back up.
 */
function write(next: StoredMap): boolean {
  const before = readRaw();
  const serialized = JSON.stringify({ v: 1, players: next });
  try {
    if (typeof localStorage !== 'undefined') {
      if (Object.keys(next).length === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, serialized);
    }
  } catch {
    /* fall through — the read-back decides the outcome */
  }

  const after = readRaw();
  cache = null;
  // Notify only on a REAL change. A failed write must not wake subscribers into
  // re-reading a value that did not move.
  if (after !== before) emit();

  const stored = parse(after);
  const wanted = parse(serialized);
  return JSON.stringify(stored) === JSON.stringify(wanted);
}

/**
 * Make room for one more entry, without ever dropping a block.
 *
 * Returns the map to write. When every entry is a block the map is returned
 * unchanged and the store is allowed past the cap — see {@link MAX_TRACKED_PLAYERS}.
 */
function evictIfFull(map: StoredMap, incoming: string): StoredMap {
  if (Object.keys(map).length < MAX_TRACKED_PLAYERS || incoming in map) return map;

  const muteOnly = Object.entries(map)
    .filter(([, entry]) => entry.b !== 1)
    .sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0));

  if (muteOnly.length === 0) return map;
  const next = { ...map };
  delete next[muteOnly[0][0]];
  return next;
}

function update(pubkey: string, change: Partial<PlayerRelationship>, now: number): boolean {
  if (!PUBKEY_PATTERN.test(pubkey)) return false;
  const key = pubkey.toLowerCase();

  const { map } = current();
  const existing = map[key];
  const muted = change.muted ?? existing?.m === 1;
  const blocked = change.blocked ?? existing?.b === 1;

  // Idempotent: setting a bit to the value it already has changes nothing.
  //
  // Without this, re-blocking an already-blocked player would rewrite the
  // timestamp, which counts as a change and wakes every subscriber — so the
  // presence map would re-prune and every bubble would be re-checked for a
  // decision that did not move. Cheap to get wrong, and the churn only shows up
  // under real timing.
  if (existing !== undefined && existing.m === 1 === muted && existing.b === 1 === blocked) {
    return true;
  }
  if (existing === undefined && !muted && !blocked) return true;

  const next = evictIfFull({ ...map }, key);
  if (!muted && !blocked) delete next[key];
  else {
    next[key] = {
      ...(muted ? { m: 1 as const } : {}),
      ...(blocked ? { b: 1 as const } : {}),
      at: now,
    };
  }

  return write(next);
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** What this player has decided about `pubkey`. Never throws. */
export function relationshipFor(pubkey: string): PlayerRelationship {
  if (!pubkey) return NO_RELATIONSHIP;
  const entry = current().map[pubkey.toLowerCase()];
  if (!entry) return NO_RELATIONSHIP;
  return { muted: entry.m === 1, blocked: entry.b === 1 };
}

export function isBlocked(pubkey: string): boolean {
  return relationshipFor(pubkey).blocked;
}

export function isMuted(pubkey: string): boolean {
  return relationshipFor(pubkey).muted;
}

/**
 * Whether this player's communication should be discarded.
 *
 * **The precedence rule, in one place.** Blocking is the stronger action and
 * implies everything muting does, so a blocked player is silenced whether or not
 * the mute bit is also set. Every ingest path asks this rather than re-deriving
 * `blocked || muted`, so the two bits can never be combined differently in two
 * places.
 */
export function isCommunicationSilenced(pubkey: string): boolean {
  const relationship = relationshipFor(pubkey);
  return relationship.blocked || relationship.muted;
}

/** Every relationship, newest change first. Stable reference between changes. */
export function listRelationships(): readonly PlayerSafetyEntry[] {
  return current().entries;
}

/** The snapshot `useSyncExternalStore` compares by identity. */
export function relationshipsSnapshot(): readonly PlayerSafetyEntry[] {
  return current().entries;
}

// ── Writing ─────────────────────────────────────────────────────────────────

/**
 * Mute or unmute a player. Returns whether the change was persisted.
 *
 * Muting does NOT touch the block bit: they are independent, so unmuting
 * someone who is also blocked cannot accidentally unblock them.
 */
export function setPlayerMuted(pubkey: string, muted: boolean, now: number = Date.now()): boolean {
  return update(pubkey, { muted }, now);
}

/**
 * Block or unblock a player. Returns whether the change was persisted.
 *
 * Unblocking leaves any mute in place. Someone who was muted and then blocked is
 * still muted when the block is lifted, which is what the player asked for at
 * each step.
 */
export function setPlayerBlocked(
  pubkey: string,
  blocked: boolean,
  now: number = Date.now(),
): boolean {
  return update(pubkey, { blocked }, now);
}

/**
 * Forget every relationship.
 *
 * Exists for tests and for a future "reset safety settings" control. It is
 * deliberately not reachable from any current UI: a single control that silently
 * unblocks everyone is the shape of an accident.
 */
export function clearAllRelationships(): boolean {
  return write({});
}

// ── Subscribing ─────────────────────────────────────────────────────────────

/**
 * Subscribe to relationship changes. Returns an unsubscribe function.
 *
 * The `storage` listener is what makes Block in one tab reach another tab: the
 * browser fires it in every other document of this origin. It is attached lazily
 * so importing this module never touches `window`, and removed when the last
 * subscriber leaves.
 */
export function subscribeRelationships(onChange: () => void): () => void {
  listeners.add(onChange);

  if (!storageListenerAttached && typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorageEvent);
    storageListenerAttached = true;
  }

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && storageListenerAttached && typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorageEvent);
      storageListenerAttached = false;
    }
  };
}

function handleStorageEvent(event: StorageEvent): void {
  // `key === null` means the whole store was cleared, which affects us too.
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  cache = null;
  emit();
}

/** The storage key, exported so tests and documentation name it once. */
export const PLAYER_SAFETY_STORAGE_KEY = STORAGE_KEY;
