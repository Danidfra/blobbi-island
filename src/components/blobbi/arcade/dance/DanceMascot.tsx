import { forwardRef } from 'react';

import { cn } from '@/lib/utils';
import { MascotBlobbi } from '../../MascotBlobbi';

/**
 * The Blobbi on the dance stage.
 *
 * ## Why the mascot and not the player's own Blobbi
 *
 * The player's Blobbi is rendered by `MovableBlobbi`, which is wired to the
 * world's position system, the gaze tracker, the accessory overlay, the
 * multiplayer layer and a live Nostr query. Mounting that inside a modal to make
 * it wave would drag every one of those dependencies into a rhythm game's frame
 * budget for a decoration. `MascotBlobbi` is the same artwork pipeline with none
 * of the wiring — a memoised SVG string, no hooks, no data — which is exactly
 * what the brief asks for: a small decorative Blobbi treatment rather than a
 * duplicated pet renderer.
 *
 * ## Why it is inert
 *
 * It is `aria-hidden` and `pointer-events-none`, always. A player mid-song must
 * never be able to tap the mascot instead of a lane, and a screen-reader user
 * must never have to page past it to reach the controls. It carries information
 * nobody needs to act on, so it carries no semantics at all.
 *
 * ## Why the mood is an attribute
 *
 * The frame loop reacts to a judgement by writing `data-mood` onto this node —
 * one attribute write, a few times a second, and CSS owns the rest. Reacting
 * through React state would re-render the tree on every hit, at up to eight hits
 * a second, competing with the input handler for the main thread.
 */

export type DanceMascotMood = 'idle' | 'perfect' | 'good' | 'miss';

interface DanceMascotProps {
  /** Milliseconds per beat, so the bob is on the music rather than on a timer. */
  readonly beatMs: number;
  /** True while the song is running — the bob only makes sense then. */
  readonly dancing: boolean;
  readonly reducedMotion: boolean;
  readonly className?: string;
}

export const DanceMascot = forwardRef<HTMLDivElement, DanceMascotProps>(function DanceMascot(
  { beatMs, dancing, reducedMotion, className },
  ref,
) {
  return (
    <div
      ref={ref}
      data-dance-mascot
      data-mood="idle"
      aria-hidden
      style={{ ['--dance-beat' as string]: `${Math.round(beatMs)}ms` }}
      className={cn('pointer-events-none relative select-none', className)}
    >
      <div className={cn('dance-mascot-art', dancing && !reducedMotion && 'dance-mascot-bob')}>
        <MascotBlobbi
          size="sm"
          float={false}
          className="h-full w-full drop-shadow-[0_6px_10px_rgba(58,42,26,0.35)]"
        />
      </div>

      {/*
        Three reaction bubbles, rendered once. CSS shows the one matching
        `data-mood`; nothing mounts or unmounts on a hit.
      */}
      {(['perfect', 'good', 'miss'] as const).map((mood) => (
        <span
          key={mood}
          data-dance-reaction={mood}
          className="absolute -right-1 -top-1 text-base leading-none sm:text-lg"
        >
          {mood === 'perfect' ? '✨' : mood === 'good' ? '🎵' : '💫'}
        </span>
      ))}
    </div>
  );
});
