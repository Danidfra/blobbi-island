/**
 * The theater playback controller.
 *
 * This is the seam the whole theater is built around. The UI never talks to
 * YouTube; it calls a {@link TheaterPlaybackController} and renders a
 * {@link TheaterPlaybackSnapshot}. The controller talks to a
 * {@link MediaPlayerAdapter}. Nothing above this file knows a provider exists.
 *
 * ```
 *   HostControls / GuestControls / TheaterControlCard
 *              │  commands ▲ snapshots
 *              ▼           │
 *      TheaterPlaybackController          ← this file (local implementation)
 *              │
 *              ▼
 *        MediaPlayerAdapter               ← youtube-player.ts
 * ```
 *
 * ## Why the command shapes look the way they do
 *
 * Shared playback (kinds `31951` / `21951`) will eventually wrap this controller
 * rather than replace it: a shared implementation delegates to the local one and
 * additionally publishes the resulting canonical state. For that to be a wrap
 * and not a rewrite, the local controller already obeys the protocol's rules:
 *
 *  - **Every command carries an absolute result, never a delta.** `skip(+10)`
 *    resolves to a concrete target position here; there is no "+10" anywhere
 *    downstream. Deltas cannot be replayed, reordered or joined late.
 *  - **Commands are computed from one immutable snapshot**
 *    ({@link resolvePlaybackCommand}), so the state applied locally and the state
 *    that would be published are the same object, not two computations that can
 *    disagree.
 *  - **Global and local controls are separate method groups.** Global controls
 *    (play, pause, seek, skip, restart, media, rate) become shared actions;
 *    local controls (volume, mute, captions, fullscreen) are and always will be
 *    per-device and are never synchronized.
 *  - **`position` + `updatedAt` + `rate`** are the fields a canonical state needs,
 *    so they are what a command produces.
 *
 * The only thing missing for shared playback is a revision number and a
 * publisher, both of which live above this file.
 */

import type { MediaError, MediaPlayerAdapter, PlayerPhase } from '@/lib/youtube-player';

/** How far ±10 s controls move. */
export const SKIP_STEP_SECONDS = 10;

/** Never seek exactly onto the final frame; players report ENDED erratically there. */
export const END_GUARD_SECONDS = 0.25;

/** Playback rates offered by the host UI, intersected with device support. */
export const PREFERRED_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** Protocol bounds on playback speed. */
export const MIN_RATE = 0.25;
export const MAX_RATE = 4;

// ── Command model ──────────────────────────────────────────────────────────

/**
 * Why a seek happened. Presentation-only metadata: two clients that disagree
 * about the reason still agree about the position.
 */
export type SeekReason = 'direct' | 'skip-forward' | 'skip-backward' | 'restart';

export type PlaybackCommand =
  | { type: 'play'; position: number; rate: number; updatedAt: number }
  | { type: 'pause'; position: number; rate: number; updatedAt: number }
  | { type: 'seek'; position: number; rate: number; reason: SeekReason; updatedAt: number }
  | { type: 'set-media'; media: MediaRef; position: number; rate: number; updatedAt: number }
  | { type: 'set-rate'; position: number; rate: number; updatedAt: number };

export interface MediaRef {
  provider: 'youtube';
  id: string;
}

/** The shared half of playback state — what a canonical event would carry. */
export interface PlaybackState {
  media: MediaRef | null;
  status: 'playing' | 'paused';
  position: number;
  rate: number;
  /** Wall clock (ms) at which `position` was true. */
  updatedAt: number;
}

/** Everything the UI renders, shared state plus purely local concerns. */
export interface TheaterPlaybackSnapshot extends PlaybackState {
  /** Local readiness of the player, independent of the shared play/pause state. */
  phase: PlayerPhase;
  /** Live position read from the player; `position` is the last committed value. */
  currentTime: number;
  duration: number;
  /** Provider-reported title, or null when the provider does not offer one. */
  title: string | null;
  error: MediaError | null;
  muted: boolean;
  volume: number;
  captionsEnabled: boolean;
  availableRates: number[];
  /** The browser refused a programmatic play; the user must tap. */
  autoplayBlocked: boolean;
  /** Buffering has gone on long enough to be worth mentioning. */
  stalled: boolean;
}

/** Clamp a position into a video's valid range. Unknown duration is unbounded. */
export function clampPosition(position: number, duration: number): number {
  if (!Number.isFinite(position)) return 0;
  const lower = Math.max(0, position);
  if (!Number.isFinite(duration) || duration <= 0) return lower;
  return Math.min(lower, Math.max(0, duration - END_GUARD_SECONDS));
}

/**
 * Resolve a relative skip into the absolute position it lands on.
 *
 * Returns `null` when the skip is a no-op — already at 0 and skipping back, or
 * already at the end and skipping forward. A no-op must not produce a command:
 * publishing a state identical to the current one would burn a revision and,
 * for guests, cause a pointless corrective seek.
 */
export function resolveSkipTarget(
  current: number,
  deltaSeconds: number,
  duration: number,
): number | null {
  const target = clampPosition(current + deltaSeconds, duration);
  return Math.abs(target - clampPosition(current, duration)) < 0.01 ? null : target;
}

/** Restrict a requested rate to something a player will accept. */
export function normalizeRate(rate: number, available: number[]): number {
  if (!Number.isFinite(rate)) return 1;
  const bounded = Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
  if (available.length === 0) return bounded;
  return available.reduce((best, candidate) =>
    Math.abs(candidate - bounded) < Math.abs(best - bounded) ? candidate : best,
  );
}

/** Apply a command to a shared state. Pure — the same function a guest will use. */
export function applyCommand(state: PlaybackState, command: PlaybackCommand): PlaybackState {
  switch (command.type) {
    case 'play':
      return { ...state, status: 'playing', position: command.position, rate: command.rate, updatedAt: command.updatedAt };
    case 'pause':
      return { ...state, status: 'paused', position: command.position, rate: command.rate, updatedAt: command.updatedAt };
    case 'seek':
      return { ...state, position: command.position, rate: command.rate, updatedAt: command.updatedAt };
    case 'set-media':
      return { ...state, media: command.media, position: 0, rate: command.rate, updatedAt: command.updatedAt };
    case 'set-rate':
      return { ...state, position: command.position, rate: command.rate, updatedAt: command.updatedAt };
  }
}

// ── Controller interface ───────────────────────────────────────────────────

/**
 * The only playback surface the theater UI is allowed to use.
 *
 * Global controls change what *everybody* sees and are host-only once shared
 * playback exists. Local controls are per-device and are never synchronized —
 * see the protocol's control-surface split.
 */
export interface TheaterPlaybackController {
  // ── Global (host-authoritative once shared playback lands) ──
  /**
   * Put something on the screen.
   *
   * `alreadyLoaded` is for the one case where the player was *constructed*
   * around this media (see `createYouTubeAdapter`, which requires a video id):
   * the state must adopt it, but re-issuing a load would throw away the embed
   * that has already started buffering.
   */
  setMedia(media: MediaRef, options?: { startSeconds?: number; alreadyLoaded?: boolean }): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  /** Absolute seek. `reason` is presentation metadata only. */
  seek(seconds: number, reason?: SeekReason): void;
  skip(deltaSeconds: number): void;
  restart(): void;
  setRate(rate: number): void;

  // ── Local only, never synchronized ──
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setCaptionsEnabled(enabled: boolean): void;
  /**
   * Ask the browser for fullscreen on the embed.
   *
   * Resolves `false` when the browser refuses (no user-activation, an iframe
   * without `allowfullscreen`, an unsupported device). The caller MUST surface
   * that rather than dropping it: a fullscreen button that silently does nothing
   * reads as a broken app.
   */
  requestFullscreen(): Promise<boolean>;

  // ── Reading ──
  getSnapshot(): TheaterPlaybackSnapshot;
  subscribe(listener: (snapshot: TheaterPlaybackSnapshot) => void): () => void;

  /** Release the underlying player. Leaving the room MUST stop the audio. */
  destroy(): void;
}

/**
 * Build the command a control action would produce, without applying it.
 *
 * Exported because the shared-playback layer needs exactly this: compute once,
 * then apply optimistically AND publish the same immutable snapshot. Returns
 * `null` for actions that are no-ops.
 */
export function resolvePlaybackCommand(
  state: PlaybackState,
  snapshot: { currentTime: number; duration: number; availableRates: number[] },
  action:
    | { kind: 'play' }
    | { kind: 'pause' }
    | { kind: 'seek'; seconds: number; reason?: SeekReason }
    | { kind: 'skip'; deltaSeconds: number }
    | { kind: 'restart' }
    | { kind: 'set-media'; media: MediaRef }
    | { kind: 'set-rate'; rate: number },
  now: number,
): PlaybackCommand | null {
  const position = clampPosition(snapshot.currentTime, snapshot.duration);
  const rate = state.rate;

  switch (action.kind) {
    case 'play':
      return { type: 'play', position, rate, updatedAt: now };
    case 'pause':
      return { type: 'pause', position, rate, updatedAt: now };
    case 'seek': {
      const target = clampPosition(action.seconds, snapshot.duration);
      return { type: 'seek', position: target, rate, reason: action.reason ?? 'direct', updatedAt: now };
    }
    case 'skip': {
      const target = resolveSkipTarget(snapshot.currentTime, action.deltaSeconds, snapshot.duration);
      if (target === null) return null;
      return {
        type: 'seek',
        position: target,
        rate,
        reason: action.deltaSeconds >= 0 ? 'skip-forward' : 'skip-backward',
        updatedAt: now,
      };
    }
    case 'restart':
      return { type: 'seek', position: 0, rate, reason: 'restart', updatedAt: now };
    case 'set-media':
      return { type: 'set-media', media: action.media, position: 0, rate, updatedAt: now };
    case 'set-rate': {
      const normalized = normalizeRate(action.rate, snapshot.availableRates);
      if (normalized === state.rate) return null;
      return { type: 'set-rate', position, rate: normalized, updatedAt: now };
    }
  }
}

// ── Local implementation ───────────────────────────────────────────────────

export interface LocalControllerOptions {
  adapter: MediaPlayerAdapter;
  /** Injected for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Called after every command, before it is applied. The publish hook. */
  onCommand?: (command: PlaybackCommand, state: PlaybackState) => void;
}

const INITIAL_STATE: PlaybackState = {
  media: null,
  status: 'paused',
  position: 0,
  rate: 1,
  updatedAt: 0,
};

/**
 * Single-viewer playback controller.
 *
 * It owns the shared-shaped {@link PlaybackState} even though nothing is shared
 * yet, so the day a session exists the only change is where that state comes
 * from. `onCommand` is where a publisher will be plugged in: it receives the
 * exact command and the exact resulting state, which is what the paired
 * `21951` + `31951` publication needs.
 */
export class LocalTheaterPlaybackController implements TheaterPlaybackController {
  private adapter: MediaPlayerAdapter;
  private now: () => number;
  private onCommand?: (command: PlaybackCommand, state: PlaybackState) => void;
  private listeners = new Set<(snapshot: TheaterPlaybackSnapshot) => void>();
  private destroyed = false;

  private state: PlaybackState = { ...INITIAL_STATE };
  private local = {
    phase: 'idle' as PlayerPhase,
    currentTime: 0,
    duration: 0,
    title: null as string | null,
    error: null as MediaError | null,
    muted: false,
    volume: 100,
    captionsEnabled: false,
    availableRates: [1],
    autoplayBlocked: false,
    stalled: false,
  };

  constructor({ adapter, now = Date.now, onCommand }: LocalControllerOptions) {
    this.adapter = adapter;
    this.now = now;
    this.onCommand = onCommand;
    this.local.muted = adapter.isMuted();
    this.local.volume = adapter.getVolume();
    this.local.availableRates = adapter.getAvailableRates();
  }

  // ── Global controls ──

  setMedia(media: MediaRef, options?: { startSeconds?: number; alreadyLoaded?: boolean }): void {
    const command = this.dispatch({ kind: 'set-media', media });
    if (!command) return;
    this.local.error = null;
    this.local.autoplayBlocked = false;
    this.local.duration = 0;
    this.local.title = null;
    this.local.currentTime = options?.startSeconds ?? 0;
    if (!options?.alreadyLoaded) {
      // Preserve the play/pause intent across a media change: a session that was
      // playing keeps playing, a paused one stays paused.
      this.adapter.load(media.id, {
        autoplay: this.state.status === 'playing',
        startSeconds: options?.startSeconds,
      });
    }
    this.emit();
  }

  play(): void {
    if (!this.state.media) return;
    this.dispatch({ kind: 'play' });
    this.adapter.play();
    this.emit();
  }

  pause(): void {
    if (!this.state.media) return;
    this.dispatch({ kind: 'pause' });
    this.adapter.pause();
    this.emit();
  }

  togglePlay(): void {
    if (this.state.status === 'playing') this.pause();
    else this.play();
  }

  seek(seconds: number, reason: SeekReason = 'direct'): void {
    if (!this.state.media) return;
    const command = this.dispatch({ kind: 'seek', seconds, reason });
    if (!command) return;
    this.local.currentTime = command.position;
    this.adapter.seek(command.position);
    this.emit();
  }

  skip(deltaSeconds: number): void {
    if (!this.state.media) return;
    const command = this.dispatch({ kind: 'skip', deltaSeconds });
    if (!command) return; // Already at an end — a no-op publishes nothing.
    this.local.currentTime = command.position;
    this.adapter.seek(command.position);
    this.emit();
  }

  restart(): void {
    if (!this.state.media) return;
    this.dispatch({ kind: 'restart' });
    this.local.currentTime = 0;
    this.adapter.seek(0);
    this.emit();
  }

  setRate(rate: number): void {
    const command = this.dispatch({ kind: 'set-rate', rate });
    if (!command) return;
    this.adapter.setRate(command.rate);
    this.emit();
  }

  // ── Local-only controls ──

  setVolume(volume: number): void {
    const clamped = Math.min(100, Math.max(0, volume));
    this.local.volume = clamped;
    this.adapter.setVolume(clamped);
    if (clamped > 0 && this.local.muted) this.setMuted(false);
    else this.emit();
  }

  setMuted(muted: boolean): void {
    this.local.muted = muted;
    this.adapter.setMuted(muted);
    this.emit();
  }

  setCaptionsEnabled(enabled: boolean): void {
    this.local.captionsEnabled = enabled;
    this.adapter.setCaptionsEnabled(enabled);
    this.emit();
  }

  async requestFullscreen(): Promise<boolean> {
    // The world shell has its own fullscreen; request it on the iframe only, so
    // exiting video fullscreen returns to the theater rather than to the desktop.
    const element = this.adapter.getElement();
    if (!element?.requestFullscreen) return false;
    try {
      await element.requestFullscreen();
      return true;
    } catch {
      // Denied by policy or by a missing user activation. The caller says so.
      return false;
    }
  }

  // ── Reading ──

  getSnapshot(): TheaterPlaybackSnapshot {
    return { ...this.state, ...this.local };
  }

  subscribe(listener: (snapshot: TheaterPlaybackSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.clear();
    this.adapter.destroy();
  }

  // ── Player feedback (called by the hook that owns the adapter) ──

  /** Report a phase change observed on the player. */
  handlePhase(phase: PlayerPhase): void {
    this.local.phase = phase;
    if (phase !== 'buffering') this.local.stalled = false;
    if (phase === 'ended') this.state = { ...this.state, status: 'paused' };
    this.emit();
  }

  /** Report the player's own play/pause, which may disagree with the intent. */
  handlePlayingChange(isPlaying: boolean): void {
    // A player that refuses to start while the shared state says "playing" is
    // the autoplay-blocked case — surfaced, never fought.
    this.local.autoplayBlocked = !isPlaying && this.state.status === 'playing' && this.local.phase === 'ready';
    if (isPlaying) this.local.autoplayBlocked = false;
    this.emit();
  }

  handleError(error: MediaError): void {
    this.local.error = error;
    this.emit();
  }

  handleDuration(duration: number): void {
    this.local.duration = duration;
    this.emit();
  }

  handleRate(rate: number): void {
    this.local.availableRates = this.adapter.getAvailableRates();
    this.state = { ...this.state, rate };
    this.emit();
  }

  handleStalled(stalled: boolean): void {
    this.local.stalled = stalled;
    this.emit();
  }

  /**
   * Poll the player's live position. Cheap; never publishes anything.
   *
   * The title is read here rather than pushed by an event because the provider
   * has no title event: it becomes available at some point after the media is
   * accepted, and the same 250 ms poll that drives the timeline notices it.
   */
  tick(): void {
    if (this.destroyed) return;
    const currentTime = this.adapter.getPosition();
    const duration = this.adapter.getDuration();
    const title = this.state.media ? this.adapter.getTitle() : null;
    const changed =
      currentTime !== this.local.currentTime ||
      duration !== this.local.duration ||
      title !== this.local.title;
    this.local.currentTime = currentTime;
    this.local.duration = duration;
    this.local.title = title;
    if (changed) this.emit();
  }

  // ── Internals ──

  private dispatch(
    action: Parameters<typeof resolvePlaybackCommand>[2],
  ): PlaybackCommand | null {
    const command = resolvePlaybackCommand(
      this.state,
      { currentTime: this.local.currentTime, duration: this.local.duration, availableRates: this.local.availableRates },
      action,
      this.now(),
    );
    if (!command) return null;
    this.state = applyCommand(this.state, command);
    // The publication hook. Local playback ignores it; shared playback will
    // publish the paired ephemeral command and canonical state from here.
    this.onCommand?.(command, this.state);
    return command;
  }

  private emit(): void {
    if (this.destroyed) return;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
