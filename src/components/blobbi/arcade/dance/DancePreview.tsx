import type { DanceChart, DanceChartProblem } from '@/arcade/dance/chart';
import { describeChartProblems } from '@/arcade/dance/chart';
import type { DanceTrack } from '@/arcade/dance/track';
import { DANCE_JUDGMENT_WINDOWS } from '@/arcade/dance/judgment';
import { DANCE_REWARD_TUNING } from '@/arcade/dance/dance-reward';
import { DANCE_LANE_VISUALS } from './dance-visuals';

/**
 * What the player sees before pressing Start.
 *
 * Three jobs, in order of importance:
 *
 *  1. **Say what the controls are**, on both desktop and touch, before the
 *     countdown rather than during it.
 *  2. **Be honest about the audio.** The music is synthesised in the browser and
 *     is a development placeholder, and the browser will not let it start until
 *     the player taps something. Both facts are stated here rather than
 *     discovered as a silent, broken-looking run.
 *  3. **Refuse to start a broken chart.** A chart that fails validation shows the
 *     reason and no Start button at all. A run that begins and then misbehaves is
 *     strictly worse than one that never begins.
 */

interface DancePreviewProps {
  readonly track: DanceTrack;
  readonly chart: DanceChart;
  /** Non-empty when the chart failed validation. Start is then impossible. */
  readonly chartProblems: readonly DanceChartProblem[];
  /** Set when a previous run in this shell ended without a result. */
  readonly abortNotice?: string | null;
}

export function DancePreview({ track, chart, chartProblems, abortNotice }: DancePreviewProps) {
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
    <div data-dance-preview className="mx-auto flex max-w-md flex-col gap-4 py-2">
      {abortNotice && (
        <p
          role="status"
          data-dance-abort-notice
          className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800"
        >
          {abortNotice}
        </p>
      )}

      <div className="space-y-1 text-center">
        <p className="inline-block rounded-full bg-island-purple/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-island-purple">
          {seconds} seconds · {chart.difficulty}
        </p>
        <h3 className="text-xl font-bold text-island-ink sm:text-2xl">{track.title}</h3>
        <p className="blobbi-text-muted text-sm">
          Hit each arrow as it reaches the line at the bottom. Nothing is lost by missing — the
          combo just starts again.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 rounded-xl border border-island-wood/25 p-3">
        {DANCE_LANE_VISUALS.map((visual) => (
          <div key={visual.lane} className="flex items-baseline justify-between gap-2">
            <dt className="text-sm font-bold text-island-ink">
              <span aria-hidden className="mr-1">
                {visual.glyph}
              </span>
              {visual.label}
            </dt>
            <dd className="text-right text-xs blobbi-text-muted">
              <span className="font-mono">{visual.keys}</span>
              <span className="mx-1 opacity-50">·</span>
              <span>tap</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="space-y-2 rounded-xl border border-island-wood/25 p-3 text-xs blobbi-text-muted">
        <p>
          <strong className="text-island-ink">Timing.</strong> Within{' '}
          {DANCE_JUDGMENT_WINDOWS.perfect}ms is Perfect, {DANCE_JUDGMENT_WINDOWS.good}ms is Good,{' '}
          {DANCE_JUDGMENT_WINDOWS.okay}ms is Okay. Anything later is a miss.
        </p>
        <p>
          <strong className="text-island-ink">Tickets.</strong> Finish the song for{' '}
          {DANCE_REWARD_TUNING.participation}, up to{' '}
          {DANCE_REWARD_TUNING.accuracyTiers[0].tickets} more for accuracy and{' '}
          {DANCE_REWARD_TUNING.fullCombo} for a full combo — {DANCE_REWARD_TUNING.maxPerRun} at
          most. Leaving early earns nothing.
        </p>
        <p data-dance-audio-notice>
          <strong className="text-island-ink">Sound.</strong> Press Start to let the browser play
          audio — it will not start on its own. The music keeps the game&rsquo;s clock, so play with
          sound on if you can.
          {track.readiness === 'development' && (
            <>
              {' '}
              This track is a placeholder generated by the game itself, not final music.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
