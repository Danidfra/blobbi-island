import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { INVITE_LENGTH } from '@/lib/shared-playback';
import type { SharedWatchState } from '@/hooks/useSharedPlayback';

interface TheaterSessionPanelProps {
  shared: SharedWatchState;
  /** Whether there is media on screen to host a session around. */
  hasMedia: boolean;
  /** Whether a signer is available at all. */
  canPublish: boolean;
  /** How many visible players presence says are in this session, including you. */
  participants: number;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onLeave: () => void;
  onEnd: () => void;
}

/**
 * The one strip of session UI, inside the existing control card.
 *
 * Not a modal and not a second screen: watching together is a property of the
 * theater you are already sitting in, so it is a row under the controls rather
 * than a dialog over them.
 *
 * The invitation code is presented as a **handle, never a password**: it is an
 * indexed tag on a public relay and anyone can enumerate it (protocol §13.4).
 * Nothing here implies otherwise: no "keep this secret", no masking, no lock.
 */
export function TheaterSessionPanel({
  shared,
  hasMedia,
  canPublish,
  participants,
  onCreate,
  onJoin,
  onLeave,
  onEnd,
}: TheaterSessionPanelProps) {
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  const busy = shared.connectionState === 'creating' || shared.connectionState === 'joining';

  // Once a session exists, the code entry has served its purpose. Clearing it
  // here rather than on submit means a failed join keeps what was typed (so a
  // typo can be corrected), while leaving a session later returns to the plain
  // "Watching locally" row instead of a stale, empty form.
  useEffect(() => {
    if (shared.mode === 'local') return;
    setJoining(false);
    setCode('');
  }, [shared.mode]);

  const copy = useCallback(async () => {
    if (!shared.invitationCode) return;
    try {
      await navigator.clipboard.writeText(shared.invitationCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the code is on screen either way.
      setCopied(false);
    }
  }, [shared.invitationCode]);

  const submitJoin = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onJoin(code);
    },
    [code, onJoin],
  );

  // ── Hosting ──────────────────────────────────────────────────────────────
  if (shared.mode === 'hosting') {
    return (
      <div data-theater-session="hosting" className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-1.5">
        <span className="text-[11px] text-white/60">Watch code</span>
        <code
          data-theater-invite-code
          className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-sm tracking-[0.2em] text-white"
        >
          {shared.invitationCode}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy watch code"
          className="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <span className="flex items-center gap-1 text-[11px] text-white/50">
          <Users className="h-3.5 w-3.5" />
          {participants}
        </span>
        <span className="text-[11px] text-white/40">You are hosting</span>
        <button
          type="button"
          onClick={onEnd}
          className="ml-auto rounded-full border border-white/20 px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:border-white/40 hover:text-white"
        >
          End session
        </button>
      </div>
    );
  }

  // ── Joined ───────────────────────────────────────────────────────────────
  if (shared.mode === 'joined') {
    return (
      <div data-theater-session="joined" className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-1.5">
        <span className="text-[11px] text-white/60">
          {shared.connectionState === 'ended'
            ? 'The host ended this session'
            : shared.connectionState === 'reconnecting'
              ? 'Reconnecting…'
              : 'Watching together'}
        </span>
        <code
          data-theater-invite-code
          className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-xs tracking-[0.2em] text-white/80"
        >
          {shared.invitationCode}
        </code>
        <span className="flex items-center gap-1 text-[11px] text-white/50">
          <Users className="h-3.5 w-3.5" />
          {participants}
        </span>
        {shared.hostAway && (
          <span className="text-[11px] text-amber-200/80">Host may have disconnected</span>
        )}
        {/* Who controls playback is stated once, by the control bar itself
            (`GuestControls`), right next to the controls it is about. Repeating
            it here would put the same sentence on screen twice. */}
        <button
          type="button"
          onClick={onLeave}
          className="ml-auto rounded-full border border-white/20 px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:border-white/40 hover:text-white"
        >
          Leave session
        </button>
      </div>
    );
  }

  // ── Local ────────────────────────────────────────────────────────────────
  return (
    <div data-theater-session="local" className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-1.5">
      {joining ? (
        <form className="flex flex-1 items-center gap-2" onSubmit={submitJoin} data-block-move>
          <label htmlFor="theater-watch-code" className="text-[11px] text-white/60">
            Code
          </label>
          <input
            id="theater-watch-code"
            aria-label="Watch session code"
            value={code}
            autoFocus
            spellCheck={false}
            maxLength={INVITE_LENGTH + 2}
            placeholder="B7X4QP"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            // The world listens for keystrokes; this input must not feed it.
            onKeyDown={(e) => e.stopPropagation()}
            className={cn(
              'w-28 rounded-full border border-white/20 bg-black/50 px-3 py-1 font-mono text-sm uppercase',
              'tracking-[0.2em] text-white/90 outline-none placeholder:text-white/30 focus:border-white/50',
            )}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-black disabled:opacity-50"
          >
            {shared.connectionState === 'joining' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Join'}
          </button>
          <button
            type="button"
            onClick={() => setJoining(false)}
            className="rounded-full border border-white/20 px-2.5 py-1 text-[11px] text-white/60 hover:text-white"
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className="text-[11px] text-white/50">Watching locally</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onCreate}
              // Hosting is a session ABOUT something: without media there is
              // nothing to publish a session for.
              disabled={!hasMedia || !canPublish || busy}
              title={
                !canPublish
                  ? 'Log in to start a watch session'
                  : !hasMedia
                    ? 'Load a video first'
                    : undefined
              }
              className="rounded-full border border-white/25 px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:border-white/50 hover:text-white disabled:opacity-40"
            >
              {shared.connectionState === 'creating' ? 'Starting…' : 'Create watch session'}
            </button>
            <button
              type="button"
              onClick={() => setJoining(true)}
              disabled={!canPublish || busy}
              title={canPublish ? undefined : 'Log in to join a watch session'}
              className="rounded-full border border-white/25 px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:border-white/50 hover:text-white disabled:opacity-40"
            >
              Join with code
            </button>
          </div>
        </>
      )}
    </div>
  );
}
