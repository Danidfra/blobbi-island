import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The cabinet the dance game is played inside.
 *
 * Before this, Blobbi Dance drew a bordered grey box on the shell's cream
 * background — a generic application panel that happened to have arrows falling
 * down it. This adds the two things that make a screen read as an arcade
 * machine rather than a form: a **marquee** above it and a **bezel** around it.
 *
 * ## What it deliberately is not
 *
 * It is not a picture of a cabinet. There is no side art, no coin slot, no
 * joystick, and no image asset of any kind — the whole frame is four borders, a
 * gradient and a row of CSS dots, because on a 320 px phone every pixel spent on
 * a drawing of a machine is a pixel taken from the lanes. The frame's job is to
 * FOCUS attention on the playfield, and a frame that crowds the playfield has
 * done the opposite of its job.
 *
 * ## Layout contract
 *
 * `min-h-0` all the way down, so the playfield gets every pixel the marquee does
 * not need and the notes have room to fall. The marquee never grows; the bezel
 * takes the rest.
 */

interface DanceCabinetProps {
  /** Marquee headline — the song, not the game (the shell titles the game). */
  readonly title: string;
  /** One short line under the headline. Kept to a few words. */
  readonly subtitle?: string;
  /** The mascot, or nothing. Rendered at the marquee's left. */
  readonly mascot?: ReactNode;
  /** Controls at the marquee's right — the sound toggle lives here. */
  readonly actions?: ReactNode;
  /** A full-width strip under the marquee: the song progress bar during play. */
  readonly meter?: ReactNode;
  readonly reducedMotion: boolean;
  /** Milliseconds per beat, so the marquee bulbs blink with the music. */
  readonly beatMs?: number;
  readonly children: ReactNode;
  readonly className?: string;
}

/** Marquee bulbs. A fixed handful of dots — decoration, and cheap. */
const BULBS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

export function DanceCabinet({
  title,
  subtitle,
  mascot,
  actions,
  meter,
  reducedMotion,
  beatMs = 500,
  children,
  className,
}: DanceCabinetProps) {
  return (
    <div
      data-dance-cabinet
      style={{ ['--dance-beat' as string]: `${Math.round(beatMs)}ms` }}
      className={cn('flex h-full min-h-0 flex-col gap-2 sm:gap-3', className)}
    >
      <div className="shrink-0 overflow-hidden rounded-2xl border-2 border-island-wood/40 bg-gradient-to-b from-island-cream-2 to-island-sand shadow-[0_4px_0_rgba(140,98,57,0.35)]">
        {/* Bulb strip. Purely decorative, and never a flashing full-screen area. */}
        <div className="flex items-center justify-center gap-1.5 bg-island-wood/15 px-2 py-1" aria-hidden>
          {BULBS.map((index) => (
            <span
              key={index}
              style={{ ['--dance-bulb-delay' as string]: `${index * 90}ms` }}
              className={cn(
                'h-1.5 w-1.5 rounded-full bg-island-purple/70 sm:h-2 sm:w-2',
                !reducedMotion && 'dance-bulb',
              )}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 px-2 py-1.5 sm:gap-3 sm:px-3 sm:py-2">
          {mascot}
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm font-black uppercase tracking-[0.18em] text-island-wood-dark sm:text-base">
              {title}
            </p>
            {subtitle && (
              <p className="truncate text-[11px] font-semibold text-island-ink-soft sm:text-xs">
                {subtitle}
              </p>
            )}
          </div>
          {/* A fixed-width slot, so the title stays optically centred with or
              without a control in it. */}
          <div className="flex w-10 shrink-0 justify-end sm:w-12">{actions}</div>
        </div>

        {meter}
      </div>

      {/* The bezel: a dark inset the playfield sits in, so the lanes read as a
          screen rather than as part of the page. */}
      <div className="min-h-0 flex-1 rounded-2xl border-2 border-island-wood-dark/60 bg-island-ink p-1.5 shadow-[inset_0_2px_10px_rgba(0,0,0,0.55)] sm:p-2">
        {children}
      </div>
    </div>
  );
}
