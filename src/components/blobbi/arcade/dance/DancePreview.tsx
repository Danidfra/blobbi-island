import type { DanceChart, DanceChartProblem } from '@/arcade/dance/chart';
import { describeChartProblems } from '@/arcade/dance/chart';
import type { DanceTrack } from '@/arcade/dance/track';
import { cn } from '@/lib/utils';

import { DANCE_LANE_VISUALS } from './dance-visuals';
import { DanceMascot } from './DanceMascot';
import { DanceSoundToggle } from './DanceSoundToggle';

/**
 * What the player sees before pressing Start.
 *
 * Four jobs, in order of importance:
 *
 *  1. **Say what the game is**, in one sentence a child can read, next to a
 *     picture of the thing they will be doing. A rhythm game explains itself in
 *     a diagram far better than in a paragraph.
 *  2. **Say what the controls are**, on both desktop and touch, before the
 *     countdown rather than during it.
 *  3. **Be honest about the audio.** The music is synthesised in the browser and
 *     is a development placeholder, and the browser will not let it start until
 *     the player taps something. Both facts are stated here rather than
 *     discovered as a silent, broken-looking run.
 *  4. **Refuse to start a broken chart.** A chart that fails validation shows the
 *     reason and no Start button at all. A run that begins and then misbehaves is
 *     strictly worse than one that never begins.
 *
 * ## What this screen deliberately no longer says
 *
 * It used to print the judgement windows in milliseconds and the full ticket
 * formula — participation, every accuracy tier, the full-combo bonus and the
 * per-run cap — before a single note had fallen. That is the tuning table, not a
 * game's instructions: it is unreadable to the audience this game is for, it
 * turns the first screen into a spreadsheet, and it invites a player to optimise
 * a formula rather than to dance.
 *
 * The two things a player actually needs to know survive, in words: **finishing
 * earns tickets and playing well earns more**, and **leaving early earns
 * nothing**. The exact numbers appear at the results, where they describe
 * something that actually happened. Nothing about the policy changed — only when
 * the arithmetic is shown.
 */

interface DancePreviewProps {
  readonly track: DanceTrack;
  readonly chart: DanceChart;
  /** Non-empty when the chart failed validation. Start is then impossible. */
  readonly chartProblems: readonly DanceChartProblem[];
  /** Set when a previous run in this shell ended without a result. */
  readonly abortNotice?: string | null;
  readonly muted: boolean;
  readonly onToggleMute: () => void;
}

export function DancePreview({
  track,
  chart,
  chartProblems,
  abortNotice,
  muted,
  onToggleMute,
}: DancePreviewProps) {
  if (chartProblems.length > 0) {
    return (
      <div
        role="alert"
        data-dance-error="chart"
        className="mx-auto max-w-md space-y-3 py-8 text-center"
      >
        <h3 className="text-lg font-bold text-island-ink">This song cannot be played</h3>
        <p className="blobbi-text-muted text-sm">
          The note chart failed its checks, so the machine will not start a run that could not be
          judged fairly.
        </p>
        <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-left font-mono text-xs text-rose-700">
          {describeChartProblems(chartProblems)}
        </p>
      </div>
    );
  }

  const seconds = Math.round(track.durationMs / 1000);

  return (
    <div data-dance-preview className="mx-auto flex max-w-md flex-col gap-3 pb-2">
      {abortNotice && (
        <p
          role="status"
          data-dance-abort-notice
          className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800"
        >
          {abortNotice}
        </p>
      )}

      {/* Marquee. The same treatment as the cabinet the game runs in, so the
          start screen and the playfield read as one machine. */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-island-wood/40 bg-gradient-to-b from-island-cream-2 to-island-sand px-4 py-3 text-center shadow-[0_4px_0_rgba(140,98,57,0.35)]">
        <DanceSoundToggle
          muted={muted}
          onToggle={onToggleMute}
          className="absolute right-2 top-2 h-9 w-9"
        />
        <DanceMascot
          beatMs={500}
          dancing={false}
          reducedMotion
          className="mx-auto mb-1 h-14 w-14 sm:h-16 sm:w-16"
        />
        <h3 className="text-xl font-black uppercase tracking-[0.16em] text-island-wood-dark sm:text-2xl">
          {track.title}
        </h3>
        <p className="mt-1 text-sm font-semibold text-island-ink">
          Tap each arrow the moment it reaches the line.
        </p>
        <p className="mt-1 text-xs blobbi-text-muted">
          About {seconds} seconds · {chart.difficulty} · missing a note only resets your combo
        </p>
      </div>

      {/*
        The controls, drawn rather than described.

        Each row is the lane's arrow, its name, the keys that fire it and the
        fact that the matching on-screen button does the same thing — which is
        the whole mapping in one glance, on a phone as well as a laptop.
      */}
      <div className="rounded-2xl border-2 border-island-wood/25 bg-island-cream/60 p-3">
        <h4 className="mb-2 text-center text-xs font-bold uppercase tracking-widest text-island-ink-soft">
          Controls
        </h4>
        <ul data-dance-controls className="grid grid-cols-2 gap-2">
          {DANCE_LANE_VISUALS.map((visual) => (
            <li key={visual.lane} className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2',
                  'text-lg font-black text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]',
                  visual.touch,
                )}
              >
                {visual.glyph}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold leading-tight text-island-ink">
                  {visual.label}
                </span>
                <span className="block font-mono text-[11px] leading-tight blobbi-text-muted">
                  {visual.keys}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-center text-xs blobbi-text-muted">
          <strong className="text-island-ink">On a keyboard,</strong> press the arrow keys or WASD.{' '}
          <strong className="text-island-ink">On a touch screen,</strong> tap the four big buttons
          under the lanes — each one belongs to the lane directly above it.
        </p>
      </div>

      <div className="space-y-2 rounded-2xl border-2 border-island-wood/25 p-3 text-xs blobbi-text-muted">
        <p>
          <strong className="text-island-ink">
            <span aria-hidden>🎟️ </span>Arcade Tickets.
          </strong>{' '}
          Finish the song to earn some, and dance accurately to earn more. Leaving early earns
          nothing.
        </p>
        <p data-dance-audio-notice>
          <strong className="text-island-ink">Sound.</strong> Press Start to let the browser play
          audio — it will not start on its own. The music keeps the game&rsquo;s clock, so play with
          sound on if you can.
          {track.readiness === 'development' && (
            <> This track is a placeholder generated by the game itself, not final music.</>
          )}
        </p>
      </div>
    </div>
  );
}
