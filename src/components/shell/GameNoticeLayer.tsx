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
 *
 * ## Compact on a phone
 *
 * On a viewport under the mobile breakpoint the game window IS the screen,
 * and the desktop chip covered too much of it. The compact treatment is the
 * same component with smaller numbers: a narrower cap, tighter padding, a
 * 24px picture, one size down on both lines, a tighter stack gap, a smaller
 * edge inset. Long names wrap to at most two lines for the headline and one
 * for the caption, so a chip can never grow past its cap or off the frame.
 */

import { useSyncExternalStore } from 'react';

import { useImmersive } from '@/hooks/useImmersive';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { gameNoticesSnapshot, subscribeGameNotices, type GameNotice } from '@/lib/game-notices';
import { cn } from '@/lib/utils';

function useGameNotices(): readonly GameNotice[] {
  return useSyncExternalStore(subscribeGameNotices, gameNoticesSnapshot, gameNoticesSnapshot);
}

export function GameNoticeLayer({ className }: { className?: string }) {
  const notices = useGameNotices();
  const immersive = useImmersive();
  const compact = useIsMobile();
  const reducedMotion = useReducedMotion();
  if (notices.length === 0) return null;

  return (
    <div
      data-testid="game-notice-layer"
      data-compact={compact ? '' : undefined}
      aria-live="polite"
      className={cn(
        'pointer-events-none absolute z-30 flex flex-col items-end',
        compact
          ? 'gap-1.5 right-[max(0.5rem,env(safe-area-inset-right))] max-w-[min(13rem,calc(100%-1rem))]'
          : 'gap-2 right-[max(0.75rem,env(safe-area-inset-right))] sm:right-4 max-w-[min(20rem,calc(100%-1.5rem))]',
        // Below the HUD row: compact (immersive) is one short line; the
        // default HUD's pills are taller.
        immersive ? 'top-11' : 'top-14',
        className,
      )}
    >
      {notices.map((notice) => (
        <GameNoticeChip key={notice.id} notice={notice} compact={compact} reducedMotion={reducedMotion} />
      ))}
    </div>
  );
}

function GameNoticeChip({
  notice,
  compact,
  reducedMotion,
}: {
  notice: GameNotice;
  compact: boolean;
  reducedMotion: boolean;
}) {
  return (
    <div
      role="status"
      data-testid="game-notice"
      data-game-notice-id={notice.id}
      className={cn(
        // The Farm's `.farm-paper`, in Island tokens: rounded-xl, 1px border,
        // paper background, ink text, inset highlight + soft drop.
        'flex max-w-full items-center rounded-xl border border-island-wood/40 bg-island-cream text-island-ink',
        'shadow-[inset_0_1px_0_hsl(0_0%_100%/0.55),0_8px_20px_-12px_hsl(var(--island-ink)/0.55)]',
        compact ? 'gap-2 px-2 py-1.5' : 'gap-3 px-3 py-2',
        !reducedMotion && 'animate-in fade-in slide-in-from-top-2 duration-200',
      )}
    >
      {notice.imageUrl ? (
        <img
          src={notice.imageUrl}
          alt=""
          className={cn('shrink-0 object-contain', compact ? 'size-6' : 'size-8')}
        />
      ) : notice.emoji ? (
        <span aria-hidden className={cn('leading-none', compact ? 'text-xl' : 'text-2xl')}>
          {notice.emoji}
        </span>
      ) : null}
      <div className="min-w-0 leading-tight">
        <p
          className={cn(
            'line-clamp-2 break-words font-bold tabular-nums',
            compact ? 'text-sm' : 'text-base',
          )}
        >
          {notice.title}
        </p>
        {notice.description ? (
          <p
            className={cn(
              'line-clamp-1 break-words text-island-ink-soft',
              compact ? 'text-[0.6875rem]' : 'text-xs',
            )}
          >
            {notice.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
