/**
 * The words around World Travel, in a child's words and with no protocol in
 * them: while the Blobbi is in another Blobbi world, a small card says where
 * and offers to call it here; while its place is being looked up, it says
 * so; when no relay answered, an honest line with a way to look again. The
 * card also says what a call is doing: waiting for the signer, on the way,
 * or what went wrong, with Try again. With World Travel off it never shows.
 */
import { Globe2, RotateCcw } from 'lucide-react';
import type { TravelPhase } from '@blobbi-kit/core';

import { cn } from '@/lib/utils';

export interface WorldAwayNoticeProps {
  name: string;
  /** Where the Blobbi is: a World id (`blobbi-pixel`, …). */
  place: string;
  /** What the Island shows of its place. */
  view: 'looking' | 'here' | 'away' | 'coming';
  /** A place's words. */
  nameOf: (place: string) => string;
  onCallHere: () => void;
  /** What a call here is doing now. */
  travel?: TravelPhase;
  /** Whether its World shows recent play ("playing there right now", or else "last there"). */
  playedThere?: boolean;
  onRetry?: () => void;
  /** Interactions counted toward it following the player here (0 or unset: none). */
  noticed?: number;
  /** No relay answered the first look; the place shown is the kept one, or here by default. */
  unreachable?: boolean;
  onRefresh?: () => void;
}

const FAILED: Record<string, (name: string) => string> = {
  declined: (n) => `The signer did not approve calling ${n} here.`,
  unreachable: () => "Couldn't reach the Blobbi relays.",
  stale: (n) => `${n} moved again meanwhile.`,
  'wrong-account': () => 'The account changed meanwhile.',
  failed: (n) => `${n} couldn't come just now.`,
};

const CARD = cn(
  'pointer-events-auto flex w-[min(calc(100%-1.5rem),24rem)] flex-col gap-1.5 rounded-2xl border border-island-wood/40 bg-island-cream px-3.5 py-2.5 text-island-ink',
  'shadow-[inset_0_1px_0_hsl(0_0%_100%/0.55),0_8px_20px_-12px_hsl(var(--island-ink)/0.55)]',
);
const PILL = 'inline-flex min-h-9 items-center gap-1.5 self-start rounded-full bg-island-ocean px-3.5 py-1.5 text-xs font-bold text-white transition-transform duration-150 ease-cozy active:scale-95 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function WorldAwayNotice({ name, place, view, nameOf, onCallHere, travel, playedThere, onRetry, noticed = 0, unreachable = false, onRefresh }: WorldAwayNoticeProps) {
  const phase = travel?.phase ?? 'idle';
  if (view === 'looking') {
    return (
      <p className={cn(CARD, 'text-sm font-semibold')} role="status" data-testid="world-travel-looking">
        Looking for {name}…
      </p>
    );
  }
  if (view === 'coming' || phase === 'arriving') {
    return (
      <p className={cn(CARD, 'text-sm font-semibold')} role="status" data-testid="world-travel-coming" data-travel-phase={phase}>
        {phase === 'signing' ? `Approve in your signer to call ${name} here.` : `${name} is on the way…`}
      </p>
    );
  }
  if (view === 'away') {
    const working = phase === 'checking' || phase === 'signing' || phase === 'publishing';
    const failed = travel?.phase === 'failed' ? travel.reason : null;
    return (
      <div className={CARD} role="status" data-testid="world-travel-away" data-place={place} data-travel-phase={phase} data-world-travel="explicit">
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <Globe2 className="size-4 shrink-0 text-island-ocean" aria-hidden />
          {playedThere === false ? `${name} was last in ${nameOf(place)}` : `${name} is in ${nameOf(place)}${playedThere ? ' right now' : ''}`}
        </p>
        <p className="text-xs text-island-ink-soft" data-testid="world-travel-detail">
          {phase === 'signing'
            ? `Approve in your signer to call ${name} here.`
            : working
              ? `Calling ${name} here…`
              : failed
                ? (FAILED[failed] ?? FAILED.failed)(name)
                : unreachable
                  ? `Couldn't reach the Blobbi relays: this is where ${name} was last seen.`
                  : noticed > 0
                    ? `${name} noticed you playing here…`
                    : `${name} comes over when you play here.`}
        </p>
        {failed && onRetry ? (
          <button type="button" className={PILL} onClick={onRetry} data-testid="world-travel-retry">
            <RotateCcw className="size-3.5" aria-hidden />
            Try again
          </button>
        ) : (
          <button type="button" className={PILL} onClick={onCallHere} disabled={working} data-testid="world-travel-call-here">
            <Globe2 className="size-3.5" aria-hidden />
            Call {name} here
          </button>
        )}
      </div>
    );
  }
  if (unreachable) {
    // Shown here by default (no relay answered, nothing kept here): said honestly, with a way to look again
    return (
      <p className={cn(CARD, 'flex-row items-center text-xs')} role="status" data-testid="world-travel-unreachable">
        <span className="flex-1">Couldn't reach the Blobbi relays, so {name} is shown here.</span>
        {onRefresh && (
          <button type="button" className={cn(PILL, 'self-auto')} onClick={onRefresh} data-testid="world-travel-refresh" data-world-travel="ignore">
            <RotateCcw className="size-3.5" aria-hidden />
            Look again
          </button>
        )}
      </p>
    );
  }
  return null;
}
