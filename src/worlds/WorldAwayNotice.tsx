/**
 * The words around World Travel, in a child's words and with no protocol in
 * them: while the Blobbi is in another Blobbi world, a card says where it is,
 * offers to bring it here (the one obvious action), and shows how close it is
 * to coming over by itself (the taps counted toward the follow threshold);
 * while its place is being looked up, it says so; when no relay answered, an
 * honest line with a way to look again. The card also says what a call is
 * doing: waiting for the player's approval, on the way, or what went wrong,
 * with Try again. With World Travel off it never shows.
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
  /** How many bring it over by themselves. */
  needed?: number;
  /** Following by playing is off for now (the last request was not approved): only the button brings it. */
  suspended?: boolean;
  /** No relay answered the first look; the place shown is the kept one, or here by default. */
  unreachable?: boolean;
  onRefresh?: () => void;
}

const FAILED: Record<string, (name: string, place: string) => string> = {
  declined: (n, p) => `The request wasn't approved, so ${n} stays in ${p} for now.`,
  unreachable: (n) => `Couldn't reach the Blobbi network just now. ${n} stays where it is.`,
  stale: (n) => `${n} moved again meanwhile.`,
  'wrong-account': () => 'The account changed meanwhile.',
  failed: (n) => `${n} couldn't come just now.`,
};

const CARD = cn(
  'pointer-events-auto flex w-[min(calc(100%-1.5rem),24rem)] flex-col gap-2 rounded-2xl border border-island-wood/40 bg-island-cream px-3.5 py-3 text-island-ink',
  'shadow-[inset_0_1px_0_hsl(0_0%_100%/0.55),0_8px_20px_-12px_hsl(var(--island-ink)/0.55)]',
);
const PILL = 'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-transform duration-150 ease-cozy active:scale-95 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const PRIMARY = cn(PILL, 'min-h-10 justify-center bg-island-ocean px-5 text-sm text-white shadow-[0_6px_14px_-8px_hsl(var(--island-ink)/0.7)]');
const QUIET = cn(PILL, 'self-start bg-island-ink/10');

/** The taps counted so far, as dots: filled for each one, empty for the rest. */
function Noticed({ count, needed }: { count: number; needed: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden data-testid="world-travel-noticed" data-count={count} data-needed={needed}>
      {Array.from({ length: needed }, (_, i) => (
        <span key={i} className={cn('size-2 rounded-full', i < count ? 'bg-island-ocean' : 'bg-island-ink/20')} />
      ))}
    </span>
  );
}

export function WorldAwayNotice({ name, place, view, nameOf, onCallHere, travel, playedThere, onRetry, noticed = 0, needed = 2, suspended = false, unreachable = false, onRefresh }: WorldAwayNoticeProps) {
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
        {phase === 'signing' ? `Approve the request to bring ${name} here.` : `${name} is on the way…`}
      </p>
    );
  }
  if (view === 'away') {
    const where = nameOf(place);
    const working = phase === 'checking' || phase === 'signing' || phase === 'publishing';
    const failed = travel?.phase === 'failed' ? travel.reason : null;
    const left = Math.max(needed - noticed, 0);
    const detail =
      phase === 'signing'
        ? `Approve the request to bring ${name} here.`
        : working
          ? `Bringing ${name} here…`
          : failed
            ? (FAILED[failed] ?? FAILED.failed)(name, where)
            : unreachable
              ? `Couldn't reach the Blobbi network: this is where ${name} was last seen.`
              : suspended
                ? `Tap the button when you want ${name} here.`
                : noticed > 0
                  ? `${name} noticed you! ${left === 1 ? 'One more tap' : `${left} more taps`} and it comes over.`
                  : `Keep playing and ${name} comes over by itself, or bring it now.`;
    return (
      <div className={CARD} role="status" data-testid="world-travel-away" data-place={place} data-travel-phase={phase} data-world-travel="explicit">
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <Globe2 className="size-4 shrink-0 text-island-ocean" aria-hidden />
          {playedThere === false ? `${name} was last in ${where}` : `${name} is in ${where}${playedThere ? ' right now' : ''}`}
        </p>
        <p className="flex items-center gap-2 text-xs text-island-ink-soft" data-testid="world-travel-detail">
          {!failed && !working && !unreachable && !suspended && <Noticed count={noticed} needed={needed} />}
          <span>{detail}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {failed && onRetry ? (
            <button type="button" className={PRIMARY} onClick={onRetry} data-testid="world-travel-retry">
              <RotateCcw className="size-4" aria-hidden />
              Try again
            </button>
          ) : (
            <button type="button" className={PRIMARY} onClick={onCallHere} disabled={working} data-testid="world-travel-call-here">
              <Globe2 className="size-4" aria-hidden />
              Bring {name} here
            </button>
          )}
        </div>
      </div>
    );
  }
  if (unreachable) {
    // Shown here by default (no relay answered, nothing kept here): said honestly, with a way to look again
    return (
      <p className={cn(CARD, 'flex-row items-center text-xs')} role="status" data-testid="world-travel-unreachable">
        <span className="flex-1">Couldn't reach the Blobbi network, so {name} is shown here.</span>
        {onRefresh && (
          <button type="button" className={QUIET} onClick={onRefresh} data-testid="world-travel-refresh" data-world-travel="ignore">
            <RotateCcw className="size-3.5" aria-hidden />
            Look again
          </button>
        )}
      </p>
    );
  }
  return null;
}
