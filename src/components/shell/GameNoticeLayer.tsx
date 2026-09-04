/**
 * The in-game notice stack: top-right of the game window, inside the bezel.
 *
 * ```
 *   ┌──────────────────────────────────────────┐
 *   │ [HUD row: location · online · account]   │
 *   │                        ┌───────────────┐ │
 *   │                        │ 🍓 +1 Strawberry│ │  ← paper chip
 *   │                        │   Received from…│ │
 *   │                        └───────────────┘ │
 *   │        (world)                            │
 *   └──────────────────────────────────────────┘
 * ```
 *
 * ## The Nostr Farm chip, in Island paper
 *
 * The Farm shows the same kind of moment (`ProduceChangeChips`) as a
 * "paper" chip at the top-right of its field: `rounded-xl`, a 1px border, a
 * card background, one inset highlight plus one soft drop shadow, `px-3
 * py-2`, a 32px sprite, a `text-base font-semibold tabular-nums` headline
 * over a `text-xs` muted caption, `gap-2` between chips, entering with
 * `fade-in slide-in-from-top-2` and leaving at once. Every one of those is
 * mirrored here; only the palette and the typeface are the Island's own
 * tokens (cream paper, wood border, ink text, Comfortaa), so the two games
 * read as one ecosystem without one wearing the other's theme.
 *
 * ## Placement
 *
 * Absolutely positioned INSIDE `BlobbiFrame`'s bezel, so it moves and clips
 * with the game window in the framed, immersive and fullscreen
 * presentations alike, and never with the browser viewport. Offset below the
 * HUD row, whose right cluster (online count, presence, account menu) owns
 * the corner itself; the compact HUD of immersive layouts is shorter, so the
 * offset follows it. Safe-area inset on the right for notched phones.
 *
 * ## Layering
 *
 * Same `z-30` band as the HUD and dock, rendered after them, so it paints
 * above the world and the HUD; the in-world overlay host (`z-40`) where
 * in-frame modals and arcade surfaces portal stays above it.
 *
 * Pointer-transparent throughout, like the Farm's: a chip never blocks a
 * tap on the world.
 */

import { useSyncExternalStore } from 'react';

import { useImmersive } from '@/hooks/useImmersive';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { gameNoticesSnapshot, subscribeGameNotices, type GameNotice } from '@/lib/game-notices';
import { cn } from '@/lib/utils';

function useGameNotices(): readonly GameNotice[] {
  return useSyncExternalStore(subscribeGameNotices, gameNoticesSnapshot, gameNoticesSnapshot);
}

export function GameNoticeLayer({ className }: { className?: string }) {
  const notices = useGameNotices();
  const immersive = useImmersive();
  const reducedMotion = useReducedMotion();
  if (notices.length === 0) return null;

  return (
    <div
      data-testid="game-notice-layer"
      aria-live="polite"
      className={cn(
        'pointer-events-none absolute z-30 flex flex-col items-end gap-2',
        'right-[max(0.75rem,env(safe-area-inset-right))] sm:right-4',
        'max-w-[min(20rem,calc(100%-1.5rem))]',
        // Below the HUD row: compact (immersive) is one short line; the
        // default HUD's pills are taller.
        immersive ? 'top-11' : 'top-14',
        className,
      )}
    >
      {notices.map((notice) => (
        <GameNoticeChip key={notice.id} notice={notice} reducedMotion={reducedMotion} />
      ))}
    </div>
  );
}

function GameNoticeChip({ notice, reducedMotion }: { notice: GameNotice; reducedMotion: boolean }) {
  return (
    <div
      role="status"
      data-testid="game-notice"
      data-game-notice-id={notice.id}
      className={cn(
        // The Farm's `.farm-paper`, in Island tokens: rounded-xl, 1px border,
        // paper background, ink text, inset highlight + soft drop.
        'flex max-w-full items-center gap-3 rounded-xl border border-island-wood/40 bg-island-cream px-3 py-2 text-island-ink',
        'shadow-[inset_0_1px_0_hsl(0_0%_100%/0.55),0_8px_20px_-12px_hsl(var(--island-ink)/0.55)]',
        !reducedMotion && 'animate-in fade-in slide-in-from-top-2 duration-200',
      )}
    >
      {notice.imageUrl ? (
        <img src={notice.imageUrl} alt="" className="size-8 shrink-0 object-contain" />
      ) : notice.emoji ? (
        <span aria-hidden className="text-2xl leading-none">
          {notice.emoji}
        </span>
      ) : null}
      <div className="min-w-0 leading-tight">
        <p className="break-words text-base font-bold tabular-nums">{notice.title}</p>
        {notice.description ? (
          <p className="break-words text-xs text-island-ink-soft">{notice.description}</p>
        ) : null}
      </div>
    </div>
  );
}
