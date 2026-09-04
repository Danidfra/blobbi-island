/**
 * The first minutes on the Island, in three short moments:
 *
 * ```
 *   1. arrival    "Blobbi Island" — a brief world reveal, once per visit
 *   2. coins      "+200 Coins"    — the initial grant, celebrated once, ever
 *   3. welcome    how to move, what to do first, that there is more to see
 * ```
 *
 * They are sequenced so they never talk over each other, and each one is
 * gated by its own fact rather than by the others' timing: the arrival plays
 * once per tab session; the celebration plays only when the REAL economy
 * entry reports that the grant was applied by this run (never on "already
 * applied", never on a remount, never twice for one player on one device);
 * the welcome shows until the player dismisses it, once per player per
 * device. All of it is local UI preference (`first-session.ts`); nothing is
 * published.
 *
 * Reduced motion is respected everywhere: the same content, no sweeping
 * animation, shorter holds. Nothing here is skippable-only-by-waiting for
 * long: the arrival is under two seconds and the Island is interactive
 * beneath the smaller moments.
 */

import { useEffect, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';

import { cn, islandCtaButtonClass } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLocation } from '@/hooks/useLocation';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useEconomyEntryStatus } from '@/inventory/useEconomyEntry';
import { INITIAL_ISLAND_COIN_ALLOCATION } from '@/inventory/economy-entry';
import {
  hasCelebratedCoinGrant,
  hasSeenArrivalThisSession,
  hasSeenWelcome,
  markArrivalSeen,
  markCoinGrantCelebrated,
  markWelcomeSeen,
} from '@/lib/first-session';
import { CoinIcon } from '@/components/blobbi/CoinAmount';

/** How long the arrival holds the screen. Short: this is a hello, not a cutscene. */
export const ARRIVAL_DURATION_MS = 1700;
export const ARRIVAL_DURATION_REDUCED_MS = 1000;
/** How long the coin celebration stays before it clears itself. */
export const COIN_CELEBRATION_DURATION_MS = 2800;
export const COIN_CELEBRATION_DURATION_REDUCED_MS = 1800;

type Moment = 'idle' | 'playing' | 'done';

interface FirstSessionOverlaysProps {
  /** The world is mounted and the player is in it. Nothing shows before. */
  inWorld: boolean;
}

export function FirstSessionOverlays({ inWorld }: FirstSessionOverlaysProps) {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;
  const reducedMotion = useReducedMotion();
  const economy = useEconomyEntryStatus();

  // ── 1. arrival ──────────────────────────────────────────────────────────
  const [arrival, setArrival] = useState<Moment>('idle');
  useEffect(() => {
    if (!inWorld || !pubkey || arrival !== 'idle') return;
    if (hasSeenArrivalThisSession(pubkey)) {
      setArrival('done');
      return;
    }
    // Marked at the START so a remount mid-moment does not replay it.
    markArrivalSeen(pubkey);
    setArrival('playing');
  }, [inWorld, pubkey, arrival]);
  useEffect(() => {
    if (arrival !== 'playing') return;
    const timer = setTimeout(
      () => setArrival('done'),
      reducedMotion ? ARRIVAL_DURATION_REDUCED_MS : ARRIVAL_DURATION_MS,
    );
    return () => clearTimeout(timer);
  }, [arrival, reducedMotion]);

  // ── 2. coins ────────────────────────────────────────────────────────────
  //
  // THE REAL GRANT decides. `phase: 'applied'` with `alreadyApplied: false`
  // means this run just granted the Coins; `alreadyApplied: true` means the
  // durable marker was already there — nothing to celebrate. The local
  // "celebrated" flag only prevents a second party for the same player on
  // the same device (a remount, a reload, a later sign-in).
  const grantedNow = economy.phase === 'applied' && economy.alreadyApplied === false;
  const [coins, setCoins] = useState<Moment>('idle');
  useEffect(() => {
    if (!inWorld || !pubkey || coins !== 'idle' || arrival !== 'done') return;
    if (!grantedNow || hasCelebratedCoinGrant(pubkey)) return;
    markCoinGrantCelebrated(pubkey);
    setCoins('playing');
  }, [inWorld, pubkey, coins, arrival, grantedNow]);
  useEffect(() => {
    if (coins !== 'playing') return;
    const timer = setTimeout(
      () => setCoins('done'),
      reducedMotion ? COIN_CELEBRATION_DURATION_REDUCED_MS : COIN_CELEBRATION_DURATION_MS,
    );
    return () => clearTimeout(timer);
  }, [coins, reducedMotion]);

  // ── 3. welcome ──────────────────────────────────────────────────────────
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const showWelcome =
    inWorld &&
    !!pubkey &&
    arrival === 'done' &&
    coins !== 'playing' &&
    !welcomeDismissed &&
    !hasSeenWelcome(pubkey);
  const dismissWelcome = () => {
    if (pubkey) markWelcomeSeen(pubkey);
    setWelcomeDismissed(true);
  };

  if (!inWorld || !pubkey) return null;

  return (
    <>
      {arrival === 'playing' && <IslandArrival reducedMotion={reducedMotion} />}
      {coins === 'playing' && (
        <CoinGrantCelebration
          amount={INITIAL_ISLAND_COIN_ALLOCATION}
          reducedMotion={reducedMotion}
          onDismiss={() => setCoins('done')}
        />
      )}
      {showWelcome && <FirstSessionWelcome onDismiss={dismissWelcome} />}
    </>
  );
}

// ── the three surfaces ──────────────────────────────────────────────────────

/**
 * Arriving. A soft vignette lifts off the world while the Island's name
 * settles in and fades — a breath, then control. Under reduced motion the
 * same words simply appear and go.
 */
function IslandArrival({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div
      data-island-arrival
      data-reduced-motion={reducedMotion ? '' : undefined}
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 z-[45] flex items-center justify-center',
        reducedMotion ? 'bg-island-ink/25' : 'blobbi-arrival-veil',
      )}
    >
      <div
        className={cn(
          'flex flex-col items-center gap-1 text-center',
          reducedMotion ? '' : 'blobbi-arrival-title',
        )}
      >
        <span className="text-xs font-semibold uppercase tracking-[0.35em] text-island-cream/90 drop-shadow">
          Welcome to
        </span>
        <span className="text-4xl font-black text-island-cream drop-shadow-lg sm:text-5xl">
          Blobbi Island
        </span>
      </div>
    </div>
  );
}

const COIN_PIECES = 8;

/**
 * The initial grant. Unmistakably currency: the Coin mark, the amount, a
 * small burst of coins rising and settling — inside the game frame, never a
 * browser-style toast. Tapping it closes it early.
 */
function CoinGrantCelebration({
  amount,
  reducedMotion,
  onDismiss,
}: {
  amount: number;
  reducedMotion: boolean;
  onDismiss: () => void;
}) {
  return (
    <div
      data-coin-grant-celebration
      role="status"
      className="pointer-events-none absolute inset-0 z-[44] flex items-center justify-center"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`You received ${amount} Coins. Dismiss.`}
        className={cn(
          'pointer-events-auto relative flex flex-col items-center gap-1 rounded-panel border border-island-wood/30 bg-island-cream/95 px-8 py-5 text-center shadow-cozy-raised',
          reducedMotion ? '' : 'blobbi-coin-card',
        )}
      >
        {!reducedMotion && (
          <span aria-hidden className="pointer-events-none absolute inset-0 overflow-visible">
            {Array.from({ length: COIN_PIECES }, (_, i) => (
              <span
                key={i}
                className="blobbi-coin-piece absolute left-1/2 top-1/2"
                style={{ ['--coin-angle' as string]: `${(i / COIN_PIECES) * 360}deg`, animationDelay: `${i * 40}ms` }}
              >
                <CoinIcon className="size-5" />
              </span>
            ))}
          </span>
        )}
        <span className="flex items-center gap-2 text-3xl font-black text-island-ink">
          <CoinIcon className="size-8" />
          <span>+{amount} Coins</span>
        </span>
        <span className="text-sm font-medium text-island-ink-soft">A little something to get started.</span>
      </button>
    </div>
  );
}

/**
 * The one thing a new player needs to know: how to move, what to do first,
 * and that there is more. Small, game-like, dismissible; never a mission
 * system.
 */
function FirstSessionWelcome({ onDismiss }: { onDismiss: () => void }) {
  const { setIsMapModalOpen } = useLocation();
  return (
    <div
      data-first-session-welcome
      role="dialog"
      aria-labelledby="first-session-welcome-title"
      className="pointer-events-none absolute inset-x-0 bottom-24 z-[43] flex justify-center px-3"
    >
      <div className="pointer-events-auto w-full max-w-sm rounded-panel border border-island-wood/30 bg-island-cream/95 p-4 shadow-cozy-raised backdrop-blur-sm motion-safe:animate-[blobbi-welcome-in_400ms_ease-out_both]">
        <h2 id="first-session-welcome-title" className="text-base font-black text-island-ink">
          Welcome to Blobbi Island
        </h2>
        <p className="mt-1 text-sm text-island-ink">
          Tap somewhere to walk around. Start by visiting the Beach and find your first treasure.
        </p>
        <p className="mt-1 text-xs text-island-ink-soft">There&apos;s more to explore — the Map shows every place.</p>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-island-wood-dark hover:bg-island-cream"
            onClick={() => {
              onDismiss();
              setIsMapModalOpen(true);
            }}
          >
            <MapIcon aria-hidden className="size-4" />
            Show map
          </button>
          <button type="button" className={cn(islandCtaButtonClass, 'w-auto px-5 py-2')} onClick={onDismiss}>
            Let&apos;s go
          </button>
        </div>
      </div>
    </div>
  );
}
